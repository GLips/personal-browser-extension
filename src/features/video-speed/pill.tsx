import {
  type ReadonlySignal,
  useSignal,
  useSignalEffect,
} from "@preact/signals";
import { useRef } from "preact/hooks";
import type { DetectionStatus, VideoSpeedSession } from "./session";
import { type PillPosition, SPEED_CHOICES, type SpeedMode } from "./settings";

const DRAG_THRESHOLD_PX = 4;

type PillProps = {
  session: VideoSpeedSession;
  visible: ReadonlySignal<boolean>;
  initialPosition: PillPosition;
  initialCollapsed: boolean;
  onPositionChange: (position: PillPosition) => void;
  onCollapsedChange: (collapsed: boolean) => void;
};

export function VideoSpeedPill(props: PillProps) {
  const { session } = props;
  const collapsed = useSignal(props.initialCollapsed);
  const position = useSignal(props.initialPosition);
  const pillRef = useRef<HTMLDivElement>(null);

  // Re-place on every size change: the pill's own (collapse/expand) and the
  // viewport's, so a saved spot always lands on screen.
  useSignalEffect(() => {
    const el = pillRef.current;
    const { x, y } = position.value;
    collapsed.value;
    if (!el) return;
    const place = () => placePill(el, x, y);
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  });

  const onPointerDown = (event: PointerEvent) => {
    const el = pillRef.current;
    if (!el || event.button !== 0) return;
    if ((event.target as Element).closest("button:not([data-drag])")) return;
    const start = {
      x: event.clientX,
      y: event.clientY,
      rect: el.getBoundingClientRect(),
    };
    let dragging = false;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      const fraction = toFraction(
        el,
        start.rect.left + dx,
        start.rect.top + dy,
      );
      placePill(el, fraction.x, fraction.y);
    };
    const up = (e: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (!dragging) {
        if (collapsed.peek()) toggleCollapsed(false);
        return;
      }
      const rect = el.getBoundingClientRect();
      const fraction = toFraction(el, rect.left, rect.top);
      position.value = fraction;
      props.onPositionChange(fraction);
      e.preventDefault();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const toggleCollapsed = (value: boolean) => {
    collapsed.value = value;
    props.onCollapsedChange(value);
  };

  // Hidden by class, not unmounted: the same element stays observed, and the
  // ResizeObserver re-places it when it reappears.
  const hidden = props.visible.value ? "" : " hidden";
  const mode = session.mode.value;
  const speed = session.speed.value;
  const rate = session.playbackRate.value;
  const status = session.status.value;
  const dot = <span class={`dot ${dotClass(mode, status)}`} />;

  if (collapsed.value) {
    return (
      <div
        ref={pillRef}
        class={`pill collapsed${hidden}`}
        onPointerDown={onPointerDown}
      >
        <button
          type="button"
          data-drag
          title="Video speed: drag to move, click to open"
        >
          {dot}
          {formatRate(rate)}
        </button>
      </div>
    );
  }

  return (
    <div ref={pillRef} class={`pill${hidden}`}>
      <div class="row">
        <span class="grip" title="Drag to move" onPointerDown={onPointerDown}>
          ⠿
        </span>
        <span class="rate" title="Playing at">
          {formatRate(rate)}
        </span>
        <span
          class="mode"
          title={
            mode === "relative"
              ? "Relative: speed follows how fast the speaker talks"
              : "Fixed playback rate"
          }
        >
          {dot}
          {mode === "relative" ? "Relative" : "Fixed"}
        </span>
        <button
          type="button"
          class="collapse"
          title="Collapse"
          onClick={() => toggleCollapsed(true)}
        >
          ▾
        </button>
      </div>
      <div class="row chips">
        {SPEED_CHOICES.map((choice) => (
          <button
            type="button"
            key={choice}
            class={Math.abs(choice - speed) < 0.001 ? "chip on" : "chip"}
            onClick={() => session.setControl({ speed: choice })}
          >
            {formatRate(choice)}
          </button>
        ))}
      </div>
      {mode === "relative" && <RelativeStatus session={session} />}
    </div>
  );
}

function RelativeStatus({ session }: { session: VideoSpeedSession }) {
  const speed = formatRate(session.speed.value);
  switch (session.status.value) {
    case "needs-click":
      return (
        <button
          type="button"
          class="status listen"
          onClick={() => session.startListening()}
        >
          Click to start listening
        </button>
      );
    case "unavailable":
      return <div class="status">Can't hear this media · holding {speed}</div>;
    case "paused":
      return <div class="status">Paused · target {speed}</div>;
    case "off":
    case "listening": {
      const speaker = session.speakerRate.value;
      if (speaker === undefined) {
        return <div class="status">Listening… · target {speed}</div>;
      }
      const confidence = Math.round(session.confidence.value * 100);
      return (
        <div class="status">
          Speaker {speaker.toFixed(1)} syl/s ({confidence}%) · target {speed}
        </div>
      );
    }
  }
}

function dotClass(mode: SpeedMode, status: DetectionStatus): string {
  if (mode === "fixed") return "fixed";
  return status === "listening"
    ? "listening"
    : status === "unavailable"
      ? "unavailable"
      : "waiting";
}

export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

function placePill(el: HTMLElement, x: number, y: number) {
  const freeX = Math.max(0, window.innerWidth - el.offsetWidth);
  const freeY = Math.max(0, window.innerHeight - el.offsetHeight);
  el.style.left = `${clamp01(x) * freeX}px`;
  el.style.top = `${clamp01(y) * freeY}px`;
}

function toFraction(el: HTMLElement, left: number, top: number): PillPosition {
  const freeX = Math.max(1, window.innerWidth - el.offsetWidth);
  const freeY = Math.max(1, window.innerHeight - el.offsetHeight);
  return { x: clamp01(left / freeX), y: clamp01(top / freeY) };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
