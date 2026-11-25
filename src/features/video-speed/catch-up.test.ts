import { expect, test } from "bun:test";
import {
  advanceCatchUp,
  CATCH_UP_SCALE,
  catchUpRate,
  LINGER_SECONDS,
  newMediaSeconds,
  startCatchUp,
} from "./catch-up";

test("replay lingers past where the skip came from, then ends", () => {
  const state = startCatchUp(undefined, 100, 90);
  for (const t of [90, 99.9, 100 + LINGER_SECONDS - 0.1]) {
    expect(advanceCatchUp(state, t)).toBeDefined();
  }
  expect(advanceCatchUp(state, 100 + LINGER_SECONDS)).toBeUndefined();
});

test("only media past the rejoin point counts as new", () => {
  const state = startCatchUp(undefined, 100, 90);
  expect(newMediaSeconds(state, 95, 96)).toBe(0);
  expect(newMediaSeconds(state, 99.5, 101)).toBe(1);
  expect(newMediaSeconds(undefined, 95, 96)).toBe(1);
});

test("repeated skips replay back to the furthest point; scrubbing away cancels", () => {
  const first = startCatchUp(undefined, 100, 90);
  const second = startCatchUp(first, 93, 83);
  expect(second).toEqual({ from: 83, rejoin: 100, until: 110 });
  expect(advanceCatchUp(second, 60)).toBeUndefined();
});

test("slows by the scale but never below 1×", () => {
  expect(catchUpRate(2 * CATCH_UP_SCALE, 2)).toBe(1.5);
  expect(catchUpRate(1.2 * CATCH_UP_SCALE, 1.2)).toBe(1);
  expect(catchUpRate(0.8 * CATCH_UP_SCALE, 0.8)).toBe(0.8);
});

test("three rapid skips back replay the full 30 s, plus the linger, before normal speed returns", () => {
  let state = startCatchUp(undefined, 100, 90);
  state = startCatchUp(state, 90.2, 80.2);
  state = startCatchUp(state, 80.4, 70.4);
  expect(state).toEqual({ from: 70.4, rejoin: 100, until: 110 });
  expect(advanceCatchUp(state, 109.5)).toBeDefined();
  expect(advanceCatchUp(state, 110)).toBeUndefined();
});
