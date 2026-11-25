import { expect, test } from "bun:test";
import { nextPlaybackRate, targetPlaybackRate } from "./rate-controller";

const base = {
  currentRate: 1,
  speakerRate: 4.5,
  confidence: 1,
  typicalRate: 4.5,
  speed: 2.5,
  minRate: 0.75,
  maxRate: 3.5,
  tickSeconds: 1,
};

test("slow speakers get sped up more, fast ones less, within limits", () => {
  expect(targetPlaybackRate({ ...base, speakerRate: 4.5 })).toBeCloseTo(2.5);
  expect(targetPlaybackRate({ ...base, speakerRate: 6 })).toBeCloseTo(1.875);
  expect(targetPlaybackRate({ ...base, speakerRate: 2 })).toBe(3.5);
});

test("walks toward the target in bounded steps and settles", () => {
  let rate = 1;
  const seen: number[] = [];
  for (let i = 0; i < 30; i++) {
    const next = nextPlaybackRate({ ...base, currentRate: rate });
    seen.push(Math.abs(next - rate));
    rate = next;
  }
  expect(Math.max(...seen)).toBeLessThanOrEqual(0.15 + 1e-9);
  expect(rate).toBeCloseTo(2.5, 1);
});

test("holds the current rate when the estimate is unsure", () => {
  expect(nextPlaybackRate({ ...base, currentRate: 1.7, confidence: 0.2 })).toBe(
    1.7,
  );
});
