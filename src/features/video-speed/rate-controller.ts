/**
 * Picks the playback rate that makes a speaker sound like a typical speaker
 * played at the user's chosen speed: a slow talker gets sped up more, a fast
 * one less. Pure, called once per control tick.
 */

export type RateLimits = { minRate: number; maxRate: number };

export type RateControllerInput = RateLimits & {
  currentRate: number;
  /** The speaker's natural syllables per second, already smoothed. */
  speakerRate: number;
  confidence: number;
  /** Syllables per second of a typical speaker at 1×. */
  typicalRate: number;
  /** The user's chosen speed, read as "a typical speaker at this speed". */
  speed: number;
  tickSeconds: number;
};

export const MIN_CONFIDENCE = 0.5;
// Fast enough to settle within a few seconds, slow enough not to lurch.
const MAX_STEP_PER_SECOND = 0.15;
// Changes smaller than this aren't audible and only spam ratechange events.
const DEADBAND = 0.04;

export function clampRate(rate: number, limits: RateLimits): number {
  return Math.min(limits.maxRate, Math.max(limits.minRate, rate));
}

export function targetPlaybackRate(input: RateControllerInput): number {
  if (input.confidence < MIN_CONFIDENCE || input.speakerRate <= 0) {
    return clampRate(input.speed, input);
  }
  return clampRate(
    (input.typicalRate * input.speed) / input.speakerRate,
    input,
  );
}

export function nextPlaybackRate(input: RateControllerInput): number {
  // Below confidence, hold whatever rate is playing rather than drift.
  if (input.confidence < MIN_CONFIDENCE) return input.currentRate;
  const target = targetPlaybackRate(input);
  const delta = target - input.currentRate;
  if (Math.abs(delta) < DEADBAND) return input.currentRate;
  const maxStep = MAX_STEP_PER_SECOND * input.tickSeconds;
  return round2(
    input.currentRate + Math.sign(delta) * Math.min(Math.abs(delta), maxStep),
  );
}

/** Exponential smoothing whose weight depends on elapsed time, not tick count. */
export function smoothSpeakerRate(
  previous: number | undefined,
  sample: number,
  tickSeconds: number,
  timeConstantSeconds = 8,
): number {
  if (previous === undefined) return sample;
  const alpha = 1 - Math.exp(-tickSeconds / timeConstantSeconds);
  return previous + alpha * (sample - previous);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
