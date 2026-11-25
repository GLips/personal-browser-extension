import type { Signal } from "@preact/signals";
import { format } from "date-fns";
import type { SnoozeParse } from "./date-parser";

export type PanelPhase =
  | { kind: "typing" }
  | { kind: "snoozing" }
  | { kind: "failed"; message: string };

/** Where the panel sits beside Gmail's menu, and the menu's colors to match its theme. */
export type PanelPlacement = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  background: string;
  color: string;
};

export function SnoozePanel(props: {
  text: Signal<string>;
  parse: Signal<SnoozeParse>;
  phase: Signal<PanelPhase>;
  placement: Signal<PanelPlacement>;
}) {
  const { top, bottom, left, width, background, color } = props.placement.value;
  // Preact 11 no longer appends "px" to numeric style values.
  const px = (n: number | undefined) =>
    n === undefined ? undefined : `${n}px`;
  return (
    <div
      class="panel"
      style={{
        top: px(top),
        bottom: px(bottom),
        left: px(left),
        width: px(width),
        background,
        color,
      }}
      role="status"
    >
      <div class="field">
        {props.text.value ? (
          <span class="typed">{props.text.value}</span>
        ) : (
          <span class="hint">Type a time, e.g. "fri 3pm"</span>
        )}
        {props.phase.value.kind === "typing" && <span class="caret" />}
      </div>
      <PanelStatus parse={props.parse.value} phase={props.phase.value} />
    </div>
  );
}

function PanelStatus({
  parse,
  phase,
}: {
  parse: SnoozeParse;
  phase: PanelPhase;
}) {
  if (phase.kind === "snoozing") return <div class="status">Snoozing…</div>;
  if (phase.kind === "failed") {
    return <div class="status error">{phase.message}</div>;
  }
  switch (parse.kind) {
    case "empty":
      return null;
    case "unreadable":
      return <div class="status muted">Can't read that as a time yet</div>;
    case "past":
      return (
        <div class="status error">
          {describe(parse.date)} has already passed
        </div>
      );
    case "ok":
      return (
        <div class="status">
          Until <strong>{describe(parse.date)}</strong>
          <kbd>↵</kbd>
        </div>
      );
  }
}

function describe(date: Date) {
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return format(
    date,
    sameYear ? "EEE, MMM d 'at' h:mm a" : "EEE, MMM d, yyyy 'at' h:mm a",
  );
}

export const snoozePanelCss = `
:host { all: initial; }
.panel {
  position: fixed;
  z-index: 2147483000;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(60, 64, 67, 0.15), 0 1px 2px rgba(60, 64, 67, 0.3);
  font: 14px/1.4 "Google Sans", Roboto, system-ui, sans-serif;
  pointer-events: none;
}
.field { display: flex; align-items: center; min-height: 20px; }
.typed { white-space: pre; }
.caret {
  width: 1px; height: 16px; margin-left: 1px;
  background: #0b57d0;
  animation: blink 1s steps(1) infinite;
}
@keyframes blink { 50% { opacity: 0; } }
.hint, .muted, kbd { opacity: 0.7; }
.status { margin-top: 6px; font-size: 13px; display: flex; gap: 6px; align-items: center; }
.error { color: #d93025; }
kbd {
  margin-left: auto; padding: 0 5px; border-radius: 4px;
  border: 1px solid currentColor; font: 12px/16px inherit;
}
`;
