/**
 * Estimates a speaker's syllable rate from a loudness envelope, after
 * de Jong & Wempe's syllable-nuclei method: every prominent loudness peak
 * inside speech counts as one syllable, and pauses are left out of the time
 * base, so the result is an articulation rate rather than words per minute.
 *
 * Pure: feed it envelope frames, read the estimate. Time is tracked in the
 * media's own timeline (wall time × playbackRate), so the estimate is the
 * speaker's natural rate however fast the media is playing.
 */

export type EnvelopeFrame = {
  /** RMS of the speech-band signal over the frame, linear full scale. */
  rms: number;
  /** Wall-clock seconds the frame covers. */
  wallSeconds: number;
  playbackRate: number;
};

export type SyllableRateEstimate = {
  syllablesPerSecond: number;
  /** 0–1: how much speech backs the estimate and whether it looks like speech. */
  confidence: number;
  /** Media seconds of detected speech the estimate is drawn from. */
  speechSeconds: number;
};

const DIGITAL_SILENCE_RMS = 1e-5;
const SPEECH_ABOVE_FLOOR_DB = 9;
const MIN_SPEECH_DB = -60;
const PEAK_PROMINENCE_DB = 2;
// Syllable nuclei are rarely closer than ~90 ms in natural speech.
const REFRACTORY_MEDIA_SECONDS = 0.09;
// Dips between syllables still count as speech; a quiet stretch longer than
// this is a pause and is left out of the time base.
const MAX_INTRA_SPEECH_DIP_MEDIA_SECONDS = 0.3;
const FLOOR_RISE_DB_PER_SECOND = 1.5;
const WINDOW_SPEECH_SECONDS = 15;
const FULL_CONFIDENCE_SPEECH_SECONDS = 8;
const BUCKET_MEDIA_SECONDS = 0.5;
const MAX_BUCKETS = 240;

type Bucket = { syllables: number; speechSeconds: number };

export class SyllableRateEstimator {
  private smoothed: number[] = [];
  private floorDb = 0;
  private hasFloor = false;
  private prevDb = Number.NEGATIVE_INFINITY;
  private rising = false;
  private valleyDb = Number.POSITIVE_INFINITY;
  private sinceLastPeak = Number.POSITIVE_INFINITY;
  private buckets: Bucket[] = [{ syllables: 0, speechSeconds: 0 }];
  private bucketAge = 0;
  private dipMediaSeconds = 0;
  private audibleFrameSeen = false;
  private silentWallSeconds = 0;

  push(frame: EnvelopeFrame): void {
    const mediaSeconds = frame.wallSeconds * frame.playbackRate;
    this.sinceLastPeak += mediaSeconds;
    this.advanceBucket(mediaSeconds);

    if (frame.rms < DIGITAL_SILENCE_RMS) {
      this.silentWallSeconds += frame.wallSeconds;
    } else {
      this.audibleFrameSeen = true;
      this.silentWallSeconds = 0;
    }

    const db = smoothDb(this.smoothed, toDb(frame.rms));
    this.trackFloor(db, frame.wallSeconds);
    const inSpeech =
      db > MIN_SPEECH_DB && db > this.floorDb + SPEECH_ABOVE_FLOOR_DB;
    this.countSpeechTime(inSpeech, mediaSeconds);

    // A peak is the frame where loudness stops rising. It counts when it
    // stands far enough above the dip before it and isn't too close to the
    // previous syllable.
    if (db < this.prevDb && this.rising) {
      const peakDb = this.prevDb;
      if (
        inSpeech &&
        peakDb - this.valleyDb >= PEAK_PROMINENCE_DB &&
        this.sinceLastPeak >= REFRACTORY_MEDIA_SECONDS
      ) {
        this.currentBucket().syllables += 1;
        this.sinceLastPeak = 0;
      }
      this.valleyDb = db;
    }
    this.rising = db > this.prevDb;
    this.valleyDb = Math.min(this.valleyDb, db);
    this.prevDb = db;
  }

  /** True once the source has produced only exact zeros for `seconds`, having never produced sound. */
  isSilentSource(seconds: number): boolean {
    return !this.audibleFrameSeen && this.silentWallSeconds >= seconds;
  }

  estimate(): SyllableRateEstimate {
    let syllables = 0;
    let speechSeconds = 0;
    for (let i = this.buckets.length - 1; i >= 0; i--) {
      const bucket = this.buckets[i] as Bucket;
      syllables += bucket.syllables;
      speechSeconds += bucket.speechSeconds;
      if (speechSeconds >= WINDOW_SPEECH_SECONDS) break;
    }
    if (speechSeconds < 1) {
      return { syllablesPerSecond: 0, confidence: 0, speechSeconds };
    }
    const syllablesPerSecond = syllables / speechSeconds;
    const plausible = syllablesPerSecond >= 1.5 && syllablesPerSecond <= 9;
    const confidence =
      Math.min(1, speechSeconds / FULL_CONFIDENCE_SPEECH_SECONDS) *
      (plausible ? 1 : 0.3);
    return { syllablesPerSecond, confidence, speechSeconds };
  }

  // A dip is held back until loudness returns: short ones join the speech
  // time, long ones (pauses) are dropped.
  private countSpeechTime(inSpeech: boolean, mediaSeconds: number) {
    if (!inSpeech) {
      this.dipMediaSeconds += mediaSeconds;
      return;
    }
    const bucket = this.currentBucket();
    if (this.dipMediaSeconds <= MAX_INTRA_SPEECH_DIP_MEDIA_SECONDS) {
      bucket.speechSeconds += this.dipMediaSeconds;
    }
    this.dipMediaSeconds = 0;
    bucket.speechSeconds += mediaSeconds;
  }

  private trackFloor(db: number, wallSeconds: number) {
    if (!this.hasFloor || db < this.floorDb) {
      this.floorDb = db;
      this.hasFloor = true;
    } else {
      this.floorDb += FLOOR_RISE_DB_PER_SECOND * wallSeconds;
    }
  }

  private currentBucket(): Bucket {
    return this.buckets[this.buckets.length - 1] as Bucket;
  }

  private advanceBucket(mediaSeconds: number) {
    this.bucketAge += mediaSeconds;
    if (this.bucketAge < BUCKET_MEDIA_SECONDS) return;
    this.bucketAge = 0;
    this.buckets.push({ syllables: 0, speechSeconds: 0 });
    if (this.buckets.length > MAX_BUCKETS) this.buckets.shift();
  }
}

function toDb(rms: number): number {
  return 20 * Math.log10(rms + 1e-10);
}

// Three-frame moving average: irons out single-frame wobble that would
// otherwise read as extra syllables.
function smoothDb(history: number[], db: number): number {
  history.push(db);
  if (history.length > 3) history.shift();
  return history.reduce((sum, value) => sum + value, 0) / history.length;
}
