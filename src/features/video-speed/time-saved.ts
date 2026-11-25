import { storage } from "wxt/utils/storage";

/**
 * Time saved is media time played minus wall time spent, so it counts
 * silence boosts. A skip-back replay counts only its wall time, as a cost:
 * at 1× you likely wouldn't have needed it.
 * Totals live in sync storage; a page batches its seconds and flushes them
 * now and then, since sync storage rate-limits writes.
 */

export type TimeSavedTotals = {
  allTimeSeconds: number;
  /** Local date the day total belongs to, as YYYY-MM-DD. */
  day: string;
  daySeconds: number;
};

export const timeSavedItem = storage.defineItem<TimeSavedTotals>(
  "sync:videoSpeed.timeSaved",
  { fallback: { allTimeSeconds: 0, day: "", daySeconds: 0 } },
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

export function addTimeSaved(
  totals: TimeSavedTotals,
  seconds: number,
  today: string,
): TimeSavedTotals {
  return {
    allTimeSeconds: totals.allTimeSeconds + seconds,
    day: today,
    daySeconds: (totals.day === today ? totals.daySeconds : 0) + seconds,
  };
}

/** Today's total as stored, or 0 once the stored day is over. */
export function daySecondsFor(totals: TimeSavedTotals, today: string): number {
  return totals.day === today ? totals.daySeconds : 0;
}

export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export async function flushTimeSaved(seconds: number): Promise<void> {
  if (Math.abs(seconds) < 0.5) return;
  const totals = await timeSavedItem.getValue();
  await timeSavedItem.setValue(addTimeSaved(totals, seconds, localDay()));
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
