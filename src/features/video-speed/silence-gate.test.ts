import { expect, test } from "bun:test";
import {
  advanceSilenceGate,
  createSilenceGate,
  PAUSE_MEDIA_SECONDS,
  type SilenceGate,
} from "./silence-gate";

const FRAME_SECONDS = 0.005;

function feed(
  gate: SilenceGate,
  rms: number,
  mediaSeconds: number,
  playbackRate = 2,
): SilenceGate[] {
  const states: SilenceGate[] = [];
  const frames = Math.round(mediaSeconds / (FRAME_SECONDS * playbackRate));
  for (let i = 0; i < frames; i++) {
    gate = advanceSilenceGate(gate, {
      rms,
      wallSeconds: FRAME_SECONDS,
      playbackRate,
    });
    states.push(gate);
  }
  return states;
}

const SPEECH = 0.1; // -20 dB
const PAUSE = 0.002; // -54 dB, under room tone of a typical recording

test("a pause boosts only after it outlasts a between-word gap, and speech ends it at once", () => {
  let gate = feed(createSilenceGate(), SPEECH, 2).at(-1) as SilenceGate;

  const shortGap = feed(gate, PAUSE, PAUSE_MEDIA_SECONDS * 0.8);
  expect(shortGap.some((s) => s.boosting)).toBe(false);

  gate = feed(gate, SPEECH, 0.5).at(-1) as SilenceGate;
  const pause = feed(gate, PAUSE, 1);
  const boostedAt = pause.findIndex((s) => s.boosting);
  expect(boostedAt).toBeGreaterThan(0);
  expect(pause.at(-1)?.boosting).toBe(true);

  // The first frame of speech ends the boost.
  const [onset] = feed(pause.at(-1) as SilenceGate, SPEECH, 0.01);
  expect(onset?.boosting).toBe(false);
});

test("a music bed under the talking never counts as a pause", () => {
  let gate = feed(createSilenceGate(), SPEECH, 2).at(-1) as SilenceGate;
  // Music 10 dB under the voice, for a long stretch with no speech at all.
  const bed = feed(gate, SPEECH * 0.3, 5);
  expect(bed.some((s) => s.boosting)).toBe(false);
  gate = bed.at(-1) as SilenceGate;
  expect(gate.quietSeconds).toBe(0);
});

test("nothing boosts before any sound has been heard", () => {
  const states = feed(createSilenceGate(), 0, 2);
  expect(states.some((s) => s.boosting)).toBe(false);
});
