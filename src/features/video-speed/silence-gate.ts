/**
 * Speeds through pauses, after Overcast's Smart Speed: once a gap between
 * words has lasted long enough to be a real pause, play it fast, and drop
 * back the moment loudness returns. Pure; the session feeds it 5 ms frames.
 *
 * "Quiet" is relative to how loud the speech itself has been, not to the
 * noise floor, so a music bed or room tone under the talking never counts as
 * a pause: only a drop well below the speaker's level does.
 */

export type GateFrame = {
  /** RMS of the speech-band signal over the frame, linear full scale. */
  rms: number;
  wallSeconds: number;
  playbackRate: number;
};

export type SilenceGate = {
  /** Slow-decaying level of recent speech peaks, in dB. */
  speechLevelDb: number | undefined;
  /** Media seconds of continuous quiet so far. */
  quietSeconds: number;
  boosting: boolean;
};

/** Chrome mutes audio above 4×, which would also blind the onset check. */
export const SILENCE_RATE = 4;
// A gap must outlast the dips between words and syllables before it's
// treated as a pause; shorter gaps are part of the speaker's rhythm.
export const PAUSE_MEDIA_SECONDS = 0.3;
// Quiet means this far under the speech level; loud enough to end a boost
// is a smaller drop, so the gate doesn't chatter at the boundary.
const QUIET_BELOW_SPEECH_DB = 22;
const ONSET_BELOW_SPEECH_DB = 15;
const ABSOLUTE_QUIET_DB = -60;
// The speech level follows peaks up at once and sinks slowly, so one quiet
// sentence doesn't make the next pause look loud.
const SPEECH_LEVEL_DECAY_DB_PER_SECOND = 1;

export function createSilenceGate(): SilenceGate {
  return { speechLevelDb: undefined, quietSeconds: 0, boosting: false };
}

export function advanceSilenceGate(
  gate: SilenceGate,
  frame: GateFrame,
): SilenceGate {
  const db = 20 * Math.log10(frame.rms + 1e-10);
  const mediaSeconds = frame.wallSeconds * frame.playbackRate;
  const decayed =
    gate.speechLevelDb === undefined
      ? undefined
      : gate.speechLevelDb - SPEECH_LEVEL_DECAY_DB_PER_SECOND * mediaSeconds;
  const speechLevelDb =
    db > ABSOLUTE_QUIET_DB && (decayed === undefined || db > decayed)
      ? db
      : decayed;
  // Nothing heard yet: no level to judge a pause against.
  if (speechLevelDb === undefined) return { ...gate, speechLevelDb };

  // Onset uses the raw frame, not a smoothed envelope: every millisecond of
  // lag at the boosted rate eats into the first syllable.
  if (db > speechLevelDb - ONSET_BELOW_SPEECH_DB) {
    return { speechLevelDb, quietSeconds: 0, boosting: false };
  }
  if (db < speechLevelDb - QUIET_BELOW_SPEECH_DB || db < ABSOLUTE_QUIET_DB) {
    const quietSeconds = gate.quietSeconds + mediaSeconds;
    return {
      speechLevelDb,
      quietSeconds,
      boosting: quietSeconds >= PAUSE_MEDIA_SECONDS,
    };
  }
  // Between the two thresholds: hold whatever the gate was doing.
  return { ...gate, speechLevelDb };
}

/** The rate for a pause, or the speech rate when boosting gains too little. */
export function silenceRate(speechRate: number): number {
  return speechRate < SILENCE_RATE * 0.9 ? SILENCE_RATE : speechRate;
}
