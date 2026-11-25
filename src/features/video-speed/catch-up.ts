/**
 * Skip-back replay: after jumping back, the replayed stretch plays slower so
 * the missed bit is easier to catch, then normal speed resumes once playback
 * passes the point where the user skipped from. Pure; the session feeds it
 * skips and media times.
 */

export const SKIP_SECONDS = 10;
/** How much slower the replayed stretch plays. */
export const CATCH_UP_SCALE = 0.75;
// timeupdate lands a little before the seek target on some players.
const SEEK_TOLERANCE_SECONDS = 0.5;

/** Media times [from, until): the stretch being replayed. */
export type CatchUp = { from: number; until: number };

/**
 * A skip back from `currentTime` to `target`. Repeated skips keep the
 * furthest point reached as the end, so two quick skips replay all of it.
 */
export function startCatchUp(
  previous: CatchUp | undefined,
  currentTime: number,
  target: number,
): CatchUp {
  return {
    from: target,
    until: Math.max(previous?.until ?? 0, currentTime),
  };
}

/**
 * Ends the replay once playback reaches its end, or when the user has
 * scrubbed somewhere outside it.
 */
export function advanceCatchUp(
  state: CatchUp | undefined,
  currentTime: number,
): CatchUp | undefined {
  if (!state) return undefined;
  if (currentTime >= state.until) return undefined;
  if (currentTime < state.from - SEEK_TOLERANCE_SECONDS) return undefined;
  return state;
}

/**
 * The rate to play while replaying: slower by CATCH_UP_SCALE, but never
 * below 1×. A rate already under 1× (chosen by the user) is left alone.
 */
export function catchUpRate(scaledRate: number, normalRate: number): number {
  return Math.max(scaledRate, Math.min(1, normalRate));
}
