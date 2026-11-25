import { effect, signal } from "@preact/signals";
import {
  type AudioTap,
  AudioUnavailableError,
  tapMediaAudio,
} from "./audio-tap";
import {
  clampRate,
  MIN_CONFIDENCE,
  nextPlaybackRate,
  smoothSpeakerRate,
  targetPlaybackRate,
} from "./rate-controller";
import {
  HARD_MAX_RATE,
  type VideoSpeedSettings,
  videoSpeedSettingsItem,
} from "./settings";
import { SyllableRateEstimator } from "./syllable-rate";

export type DetectionStatus =
  | "off"
  | "listening"
  | "paused"
  | "needs-click"
  | "unavailable";

const POLL_MS = 10;
const CONTROL_MS = 1000;
const SILENT_SOURCE_SECONDS = 4;

/**
 * Owns one page's speed control: which media it drives, the settings, and
 * the detection loop. The pill renders its signals and calls its methods.
 */
export class VideoSpeedSession {
  readonly media = signal<HTMLMediaElement | null>(null);
  readonly settings = signal<VideoSpeedSettings>(
    videoSpeedSettingsItem.fallback,
  );
  readonly status = signal<DetectionStatus>("off");
  readonly speakerRate = signal<number | undefined>(undefined);
  readonly confidence = signal(0);
  readonly playbackRate = signal(1);

  private tap: AudioTap | undefined;
  private tappedMedia: HTMLMediaElement | undefined;
  private estimator = new SyllableRateEstimator();
  private pollTimer: number | undefined;
  private controlTimer: number | undefined;
  private lastPoll = 0;
  private disposers: (() => void)[] = [];

  async start() {
    this.settings.value = await videoSpeedSettingsItem.getValue();
    this.disposers.push(
      videoSpeedSettingsItem.watch((value) => {
        this.settings.value = value;
      }),
      effect(() => this.bindMedia(this.media.value)),
      effect(() => this.applySettings(this.media.value, this.settings.value)),
      listen(document, "visibilitychange", () => this.refreshLoops()),
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

  updateSettings(patch: Partial<VideoSpeedSettings>) {
    const next = { ...this.settings.value, ...patch };
    next.speed = round2(
      clampRate(next.speed, { minRate: 0.25, maxRate: HARD_MAX_RATE }),
    );
    this.settings.value = next;
    void videoSpeedSettingsItem.setValue(next);
  }

  private bindMedia(media: HTMLMediaElement | null) {
    if (!media) return;
    this.playbackRate.value = media.playbackRate;
    // A new video in the same element: new speaker, new audio tracks, and
    // sites often reset the rate. Start over.
    const onNewSource = () => {
      this.stopDetection();
      this.applySettings(media, this.settings.peek());
    };
    const unlisten = [
      listen(media, "ratechange", () => {
        this.playbackRate.value = media.playbackRate;
      }),
      listen(media, "play", () => this.refreshLoops()),
      listen(media, "pause", () => this.refreshLoops()),
      listen(media, "loadeddata", onNewSource),
    ];
    return () => {
      for (const off of unlisten) off();
    };
  }

  private applySettings(
    media: HTMLMediaElement | null,
    settings: VideoSpeedSettings,
  ) {
    if (!media) {
      this.stopDetection();
      return;
    }
    if (!settings.auto) {
      this.stopDetection();
      this.setRate(clampRate(settings.speed, settings));
      return;
    }
    this.startDetection(media);
    // A new speed is the user's intent: jump straight to it, unstepped.
    this.setRate(
      targetPlaybackRate({
        ...settings,
        currentRate: media.playbackRate,
        speakerRate: this.speakerRate.peek() ?? 0,
        confidence: this.confidence.peek(),
        tickSeconds: 1,
      }),
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
    this.controlTimer = window.setInterval(
      () => this.control(media),
      CONTROL_MS,
    );
  }

  private stopLoops() {
    window.clearInterval(this.pollTimer);
    window.clearInterval(this.controlTimer);
    this.pollTimer = undefined;
    this.controlTimer = undefined;
  }

  private poll(media: HTMLMediaElement) {
    const now = performance.now();
    const wallSeconds = (now - this.lastPoll) / 1000;
    this.lastPoll = now;
    if (!this.tap) return;
    this.estimator.push({
      rms: this.tap.readRms(),
      wallSeconds,
      playbackRate: media.playbackRate,
    });
  }

  private control(media: HTMLMediaElement) {
    if (this.estimator.isSilentSource(SILENT_SOURCE_SECONDS)) {
      this.stopLoops();
      this.status.value = "unavailable";
      return;
    }
    const estimate = this.estimator.estimate();
    this.confidence.value = estimate.confidence;
    if (estimate.confidence < MIN_CONFIDENCE) return;
    const speakerRate = smoothSpeakerRate(
      this.speakerRate.peek(),
      estimate.syllablesPerSecond,
      CONTROL_MS / 1000,
    );
    this.speakerRate.value = speakerRate;
    this.setRate(
      nextPlaybackRate({
        ...this.settings.peek(),
        currentRate: media.playbackRate,
        speakerRate,
        confidence: estimate.confidence,
        tickSeconds: CONTROL_MS / 1000,
      }),
    );
  }

  private setRate(rate: number) {
    const media = this.media.peek();
    if (!media || Math.abs(media.playbackRate - rate) < 0.001) return;
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
