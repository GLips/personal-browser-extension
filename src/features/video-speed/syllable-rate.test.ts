import { describe, expect, test } from "bun:test";
import { SyllableRateEstimator } from "./syllable-rate";

const FRAME = 0.005;

/**
 * Speech-like envelope: raised-cosine bursts at `rate` syllables per media
 * second, in 3 s phrases split by 0.8 s pauses, over a low noise floor.
 */
function feed(
  estimator: SyllableRateEstimator,
  rate: number,
  playbackRate: number,
  wallSeconds: number,
) {
  const phrase = 3;
  const pause = 0.8;
  for (let t = 0; t < wallSeconds; t += FRAME) {
    const media = t * playbackRate;
    const inPhrase = media % (phrase + pause) < phrase;
    const phase = (media * rate) % 1;
    const burst = inPhrase ? 0.5 - 0.5 * Math.cos(2 * Math.PI * phase) : 0;
    const noise = 0.002 * (1 + Math.sin(t * 977));
    estimator.push({
      rms: 0.003 + noise + 0.2 * burst,
      wallSeconds: FRAME,
      playbackRate,
    });
  }
}

describe("SyllableRateEstimator", () => {
  test.each([3, 4.5, 6.5])("counts %p syllables/s within 12%%", (rate) => {
    const estimator = new SyllableRateEstimator();
    feed(estimator, rate, 1, 30);
    const { syllablesPerSecond, confidence } = estimator.estimate();
    expect(Math.abs(syllablesPerSecond - rate) / rate).toBeLessThan(0.12);
    expect(confidence).toBeGreaterThan(0.9);
  });

  test.each([2, 3])(
    "reports the natural rate while playing at %p×",
    (playbackRate) => {
      const estimator = new SyllableRateEstimator();
      feed(estimator, 5, playbackRate, 15);
      const { syllablesPerSecond } = estimator.estimate();
      expect(Math.abs(syllablesPerSecond - 5) / 5).toBeLessThan(0.12);
    },
  );

  test("tells a source of exact zeros apart from quiet audio", () => {
    const silent = new SyllableRateEstimator();
    const quiet = new SyllableRateEstimator();
    for (let i = 0; i < 1000; i++) {
      silent.push({ rms: 0, wallSeconds: FRAME, playbackRate: 1 });
      quiet.push({ rms: 0.001, wallSeconds: FRAME, playbackRate: 1 });
    }
    expect(silent.isSilentSource(4)).toBe(true);
    expect(quiet.isSilentSource(4)).toBe(false);
    expect(quiet.estimate().confidence).toBe(0);
  });
});
