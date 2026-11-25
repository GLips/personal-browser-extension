import * as chrono from "chrono-node";

export type SnoozeParse =
  | { kind: "empty" }
  | { kind: "unreadable" }
  | { kind: "past"; date: Date }
  | { kind: "ok"; date: Date };

// Gmail's own presets ("Tomorrow", "Next week") snooze until 8:00 AM.
const DEFAULT_HOUR = 8;

export function parseSnoozeInput(input: string, now = new Date()): SnoozeParse {
  const text = input.trim();
  if (!text) return { kind: "empty" };

  const [result] = chrono.parse(text, now, { forwardDate: true });
  if (!result) return { kind: "unreadable" };

  const date = result.start.date();
  // "friday" alone means Friday morning, not Friday noon (chrono's default).
  if (!result.start.isCertain("hour")) {
    date.setHours(DEFAULT_HOUR, 0, 0, 0);
  }
  return date > now ? { kind: "ok", date } : { kind: "past", date };
}
