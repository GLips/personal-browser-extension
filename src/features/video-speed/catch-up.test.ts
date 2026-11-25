import { expect, test } from "bun:test";
import {
  advanceCatchUp,
  CATCH_UP_SCALE,
  catchUpRate,
  startCatchUp,
} from "./catch-up";

test("replay ends once playback passes where the skip came from", () => {
  let state = startCatchUp(undefined, 100, 90);
  for (const t of [90, 95, 99.9]) {
    state = advanceCatchUp(state, t) ?? state;
    expect(advanceCatchUp(state, t)).toBeDefined();
  }
  expect(advanceCatchUp(state, 100)).toBeUndefined();
});

test("repeated skips replay back to the furthest point; scrubbing away cancels", () => {
  const first = startCatchUp(undefined, 100, 90);
  const second = startCatchUp(first, 93, 83);
  expect(second).toEqual({ from: 83, until: 100 });
  expect(advanceCatchUp(second, 60)).toBeUndefined();
});

test("slows by the scale but never below 1×", () => {
  expect(catchUpRate(2 * CATCH_UP_SCALE, 2)).toBe(1.5);
  expect(catchUpRate(1.2 * CATCH_UP_SCALE, 1.2)).toBe(1);
  expect(catchUpRate(0.8 * CATCH_UP_SCALE, 0.8)).toBe(0.8);
});

test("three rapid skips back replay the full 30 s before normal speed returns", () => {
  let state = startCatchUp(undefined, 100, 90);
  state = startCatchUp(state, 90.2, 80.2);
  state = startCatchUp(state, 80.4, 70.4);
  expect(state).toEqual({ from: 70.4, until: 100 });
  expect(advanceCatchUp(state, 99.5)).toBeDefined();
  expect(advanceCatchUp(state, 100)).toBeUndefined();
});
