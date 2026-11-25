import { describe, expect, it } from "bun:test";
import { parseSnoozeInput } from "./date-parser";

// Tuesday, Nov 24 2026, 10:30
const now = new Date(2026, 10, 24, 10, 30);

describe("parseSnoozeInput", () => {
  it("defaults a bare day to Gmail's 8 AM", () => {
    expect(parseSnoozeInput("friday", now)).toEqual({
      kind: "ok",
      date: new Date(2026, 10, 27, 8, 0),
    });
  });

  it("keeps an explicit time", () => {
    expect(parseSnoozeInput("fri 3pm", now)).toEqual({
      kind: "ok",
      date: new Date(2026, 10, 27, 15, 0),
    });
  });

  it("rolls a time already passed today forward to tomorrow", () => {
    expect(parseSnoozeInput("9am", now)).toEqual({
      kind: "ok",
      date: new Date(2026, 10, 25, 9, 0),
    });
  });

  it("tells unreadable input apart from empty input", () => {
    expect(parseSnoozeInput("   ", now).kind).toBe("empty");
    expect(parseSnoozeInput("whenever", now).kind).toBe("unreadable");
  });
});
