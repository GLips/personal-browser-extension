/**
 * Skip-back replay: after jumping back, the replayed stretch plays slower so
 * the missed bit is easier to catch. It lingers LINGER_SECONDS past the point
 * the user skipped from (they rarely skip at the exact moment the speech got
 * hard to follow), then normal speed resumes. Pure; the session feeds it
 * skips and media times.
 */

export const SKIP_SECONDS = 10;
/** How much slower the replayed stretch plays. */
export const CATCH_UP_SCALE = 0.75;
/** How long the slow replay keeps going past where the user skipped from. */
export const LINGER_SECONDS = 10;
// timeupdate lands a little before the seek target on some players.
const SEEK_TOLERANCE_SECONDS = 0.5;

/**
 * Media times: the replay runs over [from, until). `rejoin` is the furthest
 * point reached before skipping back; media before it is being re-watched.
 */
export type CatchUp = { from: number; rejoin: number; until: number };

/**
 * A skip back from `currentTime` to `target`. Repeated skips keep the
 * furthest point reached as the end, so two quick skips replay all of it.
 */
export function startCatchUp(
  previous: CatchUp | undefined,
  currentTime: number,
  target: number,
): CatchUp {
  const rejoin = Math.max(previous?.rejoin ?? 0, currentTime);
  return { from: target, rejoin, until: rejoin + LINGER_SECONDS };
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
 * Media seconds over a tick that are new to the viewer: during a replay,
 * only what lies past `rejoin` counts.
 */
export function newMediaSeconds(
  state: CatchUp | undefined,
  lastTime: number,
  currentTime: number,
): number {
  if (!state) return currentTime - lastTime;
  return Math.max(0, currentTime - Math.max(lastTime, state.rejoin));
}

/**
 * The rate to play while replaying: slower by CATCH_UP_SCALE, but never
 * below 1×. A rate already under 1× (chosen by the user) is left alone.
 */
export function catchUpRate(scaledRate: number, normalRate: number): number {
  return Math.max(scaledRate, Math.min(1, normalRate));
}
