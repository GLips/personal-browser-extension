import { storage } from "wxt/utils/storage";

/**
 * Watched is wall time spent playing, at any speed. Saved is media time
 * played minus wall time spent, so it counts silence boosts; a skip-back
 * replay gains nothing until it passes the rejoin point, so its time counts
 * as a cost (at 1× you likely wouldn't have needed it).
 * Totals live in sync storage; a page batches its seconds and flushes them
 * now and then, since sync storage rate-limits writes.
 */

export type WatchSeconds = { watched: number; saved: number };

export type WatchTotals = {
  /** Local date the day totals belong to, as YYYY-MM-DD. */
  day: string;
  today: WatchSeconds;
  allTime: WatchSeconds;
};

export const noWatchSeconds: WatchSeconds = { watched: 0, saved: 0 };

export const watchTotalsItem = storage.defineItem<WatchTotals>(
  "sync:videoSpeed.watchTotals",
  { fallback: { day: "", today: noWatchSeconds, allTime: noWatchSeconds } },
);

// A tick whose media time moved implausibly (a seek, a stall, a new source)
// is dropped rather than counted.
const MAX_PLAUSIBLE_RATE = 16;

/** Seconds saved over one tick, or 0 when the tick isn't plain playback. */
export function savedOverTick(
  mediaSeconds: number,
  wallSeconds: number,
): number {
  if (wallSeconds <= 0 || mediaSeconds < 0) return 0;
  if (mediaSeconds > wallSeconds * MAX_PLAUSIBLE_RATE) return 0;
  return mediaSeconds - wallSeconds;
}

export function addWatchSeconds(
  a: WatchSeconds,
  b: WatchSeconds,
): WatchSeconds {
  return { watched: a.watched + b.watched, saved: a.saved + b.saved };
}

export function addToWatchTotals(
  totals: WatchTotals,
  seconds: WatchSeconds,
  today: string,
): WatchTotals {
  return {
    day: today,
    today: addWatchSeconds(todaysWatchSeconds(totals, today), seconds),
    allTime: addWatchSeconds(totals.allTime, seconds),
  };
}

/** Today's totals as stored, or zero once the stored day is over. */
export function todaysWatchSeconds(
  totals: WatchTotals,
  today: string,
): WatchSeconds {
  return totals.day === today ? totals.today : noWatchSeconds;
}

export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export async function flushWatchSeconds(seconds: WatchSeconds): Promise<void> {
  if (seconds.watched < 0.5 && Math.abs(seconds.saved) < 0.5) return;
  const totals = await watchTotalsItem.getValue();
  await watchTotalsItem.setValue(addToWatchTotals(totals, seconds, localDay()));
}

/** "45s", "3m", "1h 12m". */
export function formatDuration(seconds: number): string {
  const sign = seconds < 0 ? "−" : "";
  const s = Math.round(Math.abs(seconds));
  if (s < 60) return `${sign}${s}s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${sign}${minutes}m`;
  return `${sign}${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "12:30" or "1:02:05"; negative values get a leading minus. */
export function formatClock(seconds: number): string {
  const sign = seconds <= -0.5 ? "−" : "";
  const s = Math.round(Math.abs(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0
    ? `${sign}${h}:${pad(m)}:${pad(s % 60)}`
    : `${sign}${m}:${pad(s % 60)}`;
}
