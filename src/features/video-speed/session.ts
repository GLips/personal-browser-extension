import { computed, effect, signal } from "@preact/signals";
import {
  type AudioTap,
  AudioUnavailableError,
  tapMediaAudio,
} from "./audio-tap";
import {
  advanceCatchUp,
  CATCH_UP_SCALE,
  type CatchUp,
  catchUpRate,
  startCatchUp,
} from "./catch-up";
import {
  clampRate,
  MIN_CONFIDENCE,
  nextPlaybackRate,
  type RateControllerInput,
  smoothSpeakerRate,
  targetPlaybackRate,
} from "./rate-controller";
import { showCaptionsDuringReplay } from "./replay-captions";
import {
  HARD_MAX_RATE,
  HOTKEY_SPEED,
  type SpeedMode,
  skipSilencesItem,
  type VideoSpeedPrefs,
  videoSpeedPrefsItem,
} from "./settings";
import {
  advanceSilenceGate,
  createSilenceGate,
  type SilenceGate,
  silenceRate,
} from "./silence-gate";
import { SyllableRateEstimator } from "./syllable-rate";
import { flushTimeSaved, savedOverTick } from "./time-saved";

export type SpeedControlPatch = {
  speed?: number;
  fixedOverride?: boolean;
  skipSilences?: boolean;
};

export type DetectionStatus =
  | "off"
  | "listening"
  | "paused"
  | "needs-click"
  | "unavailable";

const POLL_MS = 10;
const CONTROL_MS = 1000;
const SILENT_SOURCE_SECONDS = 4;
const TIME_SAVED_TICK_MS = 1000;
// Sync storage rate-limits writes; a page batches its seconds saved.
const TIME_SAVED_FLUSH_MS = 15_000;

/**
 * Owns one page's speed control: which media it drives, the chosen mode and
 * speed, and the detection loop. The pill and the toolbar popup both drive
 * it. Mode and speed live only here, so every page load starts at 1× fixed.
 */
export class VideoSpeedSession {
  readonly id = crypto.randomUUID();
  readonly media = signal<HTMLMediaElement | null>(null);
  readonly prefs = signal<VideoSpeedPrefs>(videoSpeedPrefsItem.fallback);
  readonly speed = signal(1);
  /** Plays a non-1× speed as a plain playback rate instead of relative. */
  readonly fixedOverride = signal(false);
  // 1× is always true native playback; any other speed is relative unless
  // the user asked for a plain fixed rate.
  readonly mode = computed<SpeedMode>(() =>
    this.speed.value === 1 || this.fixedOverride.value ? "fixed" : "relative",
  );
  /** The pill shows only while the speed isn't 1×. */
  readonly engaged = computed(() => this.speed.value !== 1);
  readonly status = signal<DetectionStatus>("off");
  readonly speakerRate = signal<number | undefined>(undefined);
  readonly confidence = signal(0);
  readonly playbackRate = signal(1);
  /** The rate chosen for speech; a silence boost plays faster than this. */
  readonly speechRate = signal(1);
  /** True while a pause is being played at the silence rate. */
  readonly boosting = signal(false);
  readonly skipSilences = signal(skipSilencesItem.fallback);
  /** Seconds saved on the current video by playing it faster than 1×. */
  readonly savedThisVideo = signal(0);
  /** The stretch a skip back is replaying, if any. */
  readonly catchUp = signal<CatchUp | undefined>(undefined);
  // At 1× a replay changes nothing: native playback is already the floor.
  readonly replaying = computed(
    () => this.catchUp.value !== undefined && this.speed.value !== 1,
  );

  private tap: AudioTap | undefined;
  private tappedMedia: HTMLMediaElement | undefined;
  private estimator = new SyllableRateEstimator();
  private gate: SilenceGate = createSilenceGate();
  private unflushedSaved = 0;
  private pollTimer: number | undefined;
  private controlTimer: number | undefined;
  private lastPoll = 0;
  private disposers: (() => void)[] = [];
  // Until the user picks a speed, the page's own rate is left alone (a site
  // or its player may have set one).
  private touched = false;

  async start() {
    this.prefs.value = await videoSpeedPrefsItem.getValue();
    this.skipSilences.value = await skipSilencesItem.getValue();
    const flushTimer = window.setInterval(
      () => this.flushSaved(),
      TIME_SAVED_FLUSH_MS,
    );
    this.disposers.push(
      videoSpeedPrefsItem.watch((value) => {
        this.prefs.value = value;
      }),
      skipSilencesItem.watch((value) => {
        this.skipSilences.value = value;
      }),
      () => window.clearInterval(flushTimer),
      () => this.flushSaved(),
      listen(window, "pagehide", () => this.flushSaved()),
      effect(() => this.bindMedia(this.media.value)),
      effect(() =>
        this.applyControl(
          this.media.value,
          this.mode.value,
          this.speed.value,
          this.prefs.value,
          this.replaying.value,
          this.skipSilences.value,
        ),
      ),
      // Captions follow the replay: on when it starts, restored when it ends
      // (caught up, cancelled by a speed change, or the session disposed).
      effect(() => {
        const media = this.media.peek();
        if (!this.replaying.value || !media) return;
        return showCaptionsDuringReplay(media);
      }),
      listen(document, "visibilitychange", () => {
        if (document.hidden) this.flushSaved();
        this.refreshLoops();
      }),
      // Autoplay policy: a context created without a gesture stays
      // suspended until the user next clicks or types on the page.
      listen(window, "pointerdown", () => this.resumeContext(), true),
      listen(window, "keydown", () => this.resumeContext(), true),
    );
  }

  dispose() {
    this.stopDetection();
    for (const dispose of this.disposers) dispose();
  }

  setControl(patch: SpeedControlPatch) {
    this.touched = true;
    if (patch.skipSilences !== undefined) {
      this.skipSilences.value = patch.skipSilences;
      void skipSilencesItem.setValue(patch.skipSilences);
    }
    if (patch.fixedOverride !== undefined) {
      this.fixedOverride.value = patch.fixedOverride;
    }
    if (patch.speed !== undefined) {
      // A new speed is a fresh choice; it ends any skip-back replay.
      this.catchUp.value = undefined;
      const speed = round2(
        clampRate(patch.speed, { minRate: 0.25, maxRate: HARD_MAX_RATE }),
      );
      this.speed.value = speed;
      if (speed !== 1 && speed !== this.prefs.peek().quickSpeed) {
        const prefs = { ...this.prefs.peek(), quickSpeed: speed };
        this.prefs.value = prefs;
        void videoSpeedPrefsItem.setValue(prefs);
      }
    }
  }

  /** The hotkey: 1× jumps to the hotkey speed, anything else back to 1×. */
  toggleSpeedUp() {
    this.setControl({ speed: this.speed.peek() === 1 ? HOTKEY_SPEED : 1 });
  }

  /** Jumps by `seconds`; a jump back replays that stretch slower. */
  skip(seconds: number) {
    const media = this.media.peek();
    if (!media) return;
    const end = Number.isFinite(media.duration) ? media.duration : Infinity;
    const from = media.currentTime;
    const target = Math.min(end, Math.max(0, from + seconds));
    media.currentTime = target;
    this.catchUp.value =
      seconds < 0 ? startCatchUp(this.catchUp.peek(), from, target) : undefined;
  }

  /** Called from a click on the page, which lets a suspended context start. */
  startListening() {
    this.resumeContext();
  }

  private bindMedia(media: HTMLMediaElement | null) {
    if (!media) return;
    this.playbackRate.value = media.playbackRate;
    // A new video in the same element: new speaker, new audio tracks, and
    // sites often reset the rate. Start over.
    const onNewSource = () => {
      this.catchUp.value = undefined;
      this.flushSaved();
      this.savedThisVideo.value = 0;
      this.stopDetection();
      this.applyControl(
        media,
        this.mode.peek(),
        this.speed.peek(),
        this.prefs.peek(),
        false,
        this.skipSilences.peek(),
      );
    };
    // Time saved: media time played minus wall time spent, sampled once a
    // second. A tick spanning a seek is dropped rather than counted. A
    // skip-back replay re-covers media already counted, so it gains nothing
    // and its wall time counts against the total.
    let last = { media: media.currentTime, wall: performance.now() };
    let seeked = false;
    const savedTimer = window.setInterval(() => {
      const now = { media: media.currentTime, wall: performance.now() };
      const counts =
        !seeked &&
        !media.paused &&
        (media.playbackRate !== 1 || this.speed.peek() !== 1);
      if (counts) {
        const saved = savedOverTick(
          this.replaying.peek() ? 0 : now.media - last.media,
          (now.wall - last.wall) / 1000,
        );
        this.savedThisVideo.value += saved;
        this.unflushedSaved += saved;
      }
      last = now;
      seeked = false;
    }, TIME_SAVED_TICK_MS);
    const unlisten = [
      listen(media, "ratechange", () => {
        this.playbackRate.value = media.playbackRate;
      }),
      listen(media, "play", () => this.refreshLoops()),
      listen(media, "pause", () => {
        this.flushSaved();
        this.refreshLoops();
      }),
      listen(media, "seeking", () => {
        seeked = true;
      }),
      listen(media, "loadeddata", onNewSource),
      listen(media, "timeupdate", () => {
        const state = this.catchUp.peek();
        if (state)
          this.catchUp.value = advanceCatchUp(state, media.currentTime);
      }),
    ];
    return () => {
      window.clearInterval(savedTimer);
      for (const off of unlisten) off();
    };
  }

  private applyControl(
    media: HTMLMediaElement | null,
    mode: SpeedMode,
    speed: number,
    prefs: VideoSpeedPrefs,
    replaying: boolean,
    skipSilences: boolean,
  ) {
    // Any change of intent ends a boost in progress; the gate re-arms on the
    // next pause.
    this.boosting.value = false;
    if (!media) {
      this.stopDetection();
      return;
    }
    if (mode === "fixed") {
      // Fixed still listens when pauses are to be skipped, just never
      // steers the speech rate.
      if (speed !== 1 && skipSilences) this.startDetection(media);
      else this.stopDetection();
      // Fixed is exactly what was picked; the relative-mode clamp range
      // doesn't apply.
      if (this.touched) {
        this.setRate(
          replaying ? catchUpRate(speed * CATCH_UP_SCALE, speed) : speed,
        );
      }
      return;
    }
    this.startDetection(media);
    // A new speed, or a replay starting or ending, is the user's intent:
    // jump straight to it, unstepped.
    this.setRate(
      this.relativeRate(
        {
          ...prefs,
          speed,
          currentRate: this.speechRate.peek(),
          speakerRate: this.speakerRate.peek() ?? 0,
          confidence: this.confidence.peek(),
          tickSeconds: 1,
        },
        targetPlaybackRate,
        replaying,
      ),
    );
  }

  private startDetection(media: HTMLMediaElement) {
    if (this.tappedMedia === media) return;
    this.stopDetection();
    this.tappedMedia = media;
    try {
      this.tap = tapMediaAudio(media);
    } catch (error) {
      if (!(error instanceof AudioUnavailableError)) throw error;
      this.status.value = "unavailable";
      return;
    }
    this.resetEstimate();
    this.resumeContext();
    this.refreshLoops();
  }

  private resumeContext() {
    const context = this.tap?.context;
    if (context && context.state !== "running") {
      void context.resume().then(() => this.refreshLoops());
    }
  }

  private stopDetection() {
    this.stopLoops();
    this.tap?.dispose();
    this.tap = undefined;
    this.tappedMedia = undefined;
    this.status.value = "off";
    this.speakerRate.value = undefined;
    this.confidence.value = 0;
  }

  private resetEstimate() {
    this.estimator = new SyllableRateEstimator();
    this.gate = createSilenceGate();
    this.speakerRate.value = undefined;
    this.confidence.value = 0;
  }

  // Detection runs only while there's something to hear: the media is
  // playing, the tab is visible, and the audio context is running.
  private refreshLoops() {
    const media = this.media.peek();
    if (!this.tap || !media || this.status.peek() === "unavailable") return;
    if (this.tap.context.state !== "running") {
      this.status.value = "needs-click";
      this.stopLoops();
      return;
    }
    if (media.paused || document.hidden) {
      this.status.value = "paused";
      this.stopLoops();
      return;
    }
    this.status.value = "listening";
    if (this.pollTimer !== undefined) return;
    this.lastPoll = performance.now();
    this.pollTimer = window.setInterval(() => this.poll(media), POLL_MS);
    this.controlTimer = window.setInterval(() => this.control(), CONTROL_MS);
  }

  private stopLoops() {
    this.endBoost();
    window.clearInterval(this.pollTimer);
    window.clearInterval(this.controlTimer);
    this.pollTimer = undefined;
    this.controlTimer = undefined;
  }

  private poll(media: HTMLMediaElement) {
    const now = performance.now();
    const elapsed = (now - this.lastPoll) / 1000;
    if (!this.tap) return;
    const blocks = this.tap.readBlocks(elapsed);
    // Advance only by what was consumed, so leftover samples join the next poll.
    this.lastPoll += blocks.length * (blocks[0]?.seconds ?? 0) * 1000;
    for (const block of blocks) {
      const frame = {
        rms: block.rms,
        wallSeconds: block.seconds,
        playbackRate: media.playbackRate,
      };
      // Boosted stretches are pauses played fast; leaving them out keeps
      // the speaker's rate about speech alone.
      if (!this.boosting.peek()) this.estimator.push(frame);
      this.gate = advanceSilenceGate(this.gate, frame);
    }
    const boost =
      this.gate.boosting &&
      this.skipSilences.peek() &&
      this.speed.peek() !== 1 &&
      // A replay is for catching what was missed; rushing its pauses would
      // undo the slowdown.
      !this.replaying.peek();
    if (boost !== this.boosting.peek()) {
      this.boosting.value = boost;
      this.applyRate();
    }
  }

  private endBoost() {
    if (!this.boosting.peek()) return;
    this.boosting.value = false;
    this.applyRate();
  }

  private flushSaved() {
    const seconds = this.unflushedSaved;
    this.unflushedSaved = 0;
    void flushTimeSaved(seconds);
  }

  private control() {
    if (this.estimator.isSilentSource(SILENT_SOURCE_SECONDS)) {
      this.stopLoops();
      this.status.value = "unavailable";
      return;
    }
    const estimate = this.estimator.estimate();
    this.confidence.value = estimate.confidence;
    if (this.mode.peek() !== "relative") return;
    if (estimate.confidence < MIN_CONFIDENCE) return;
    const speakerRate = smoothSpeakerRate(
      this.speakerRate.peek(),
      estimate.syllablesPerSecond,
      CONTROL_MS / 1000,
    );
    this.speakerRate.value = speakerRate;
    this.setRate(
      this.relativeRate(
        {
          ...this.prefs.peek(),
          speed: this.speed.peek(),
          currentRate: this.speechRate.peek(),
          speakerRate,
          confidence: estimate.confidence,
          tickSeconds: CONTROL_MS / 1000,
        },
        nextPlaybackRate,
        this.replaying.peek(),
      ),
    );
  }

  /** Relative rate, slowed (but not below 1×) while a skip back replays. */
  private relativeRate(
    input: RateControllerInput,
    pick: (input: RateControllerInput) => number,
    replaying: boolean,
  ): number {
    if (!replaying) return pick(input);
    return catchUpRate(
      pick({ ...input, speed: input.speed * CATCH_UP_SCALE }),
      targetPlaybackRate(input),
    );
  }

  private setRate(rate: number) {
    this.speechRate.value = rate;
    this.applyRate();
  }

  private applyRate() {
    const media = this.media.peek();
    if (!media) return;
    const speech = this.speechRate.peek();
    const rate = this.boosting.peek() ? silenceRate(speech) : speech;
    if (Math.abs(media.playbackRate - rate) < 0.001) return;
    // preservesPitch is left at its default (true) so speech stays natural.
    media.playbackRate = rate;
  }
}

function listen(
  target: EventTarget,
  type: string,
  handler: () => void,
  capture = false,
): () => void {
  target.addEventListener(type, handler, capture);
  return () => target.removeEventListener(type, handler, capture);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
