import { useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { DetectionStatus, VideoSpeedSession } from "./session";
import type { PillPosition } from "./settings";

const SPEED_CHIPS = [1.5, 2, 2.5, 3];
const SPEED_STEP = 0.1;
const DRAG_THRESHOLD_PX = 4;

type PillProps = {
  session: VideoSpeedSession;
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

  const settings = session.settings.value;
  const rate = session.playbackRate.value;
  const setSpeed = (speed: number) => session.updateSettings({ speed });

  if (collapsed.value) {
    return (
      <div ref={pillRef} class="pill collapsed" onPointerDown={onPointerDown}>
        <button
          type="button"
          data-drag
          title="Video speed: drag to move, click to open"
        >
          <span
            class={`dot ${dotClass(settings.auto, session.status.value)}`}
          />
          {formatRate(rate)}
        </button>
      </div>
    );
  }

  return (
    <div ref={pillRef} class="pill">
      <div class="row">
        <span class="grip" title="Drag to move" onPointerDown={onPointerDown}>
          ⠿
        </span>
        <button
          type="button"
          class={settings.auto ? "auto on" : "auto"}
          aria-pressed={settings.auto}
          title="Auto: adjust speed to how fast the speaker talks"
          onClick={() => session.updateSettings({ auto: !settings.auto })}
        >
          <span
            class={`dot ${dotClass(settings.auto, session.status.value)}`}
          />
          Auto
        </button>
        <button
          type="button"
          title="Slower"
          onClick={() => setSpeed(settings.speed - SPEED_STEP)}
        >
          −
        </button>
        <span
          class="speed"
          title={
            settings.auto
              ? "Sound like a typical speaker at this speed"
              : "Playback speed"
          }
        >
          {formatRate(settings.speed)}
        </span>
        <button
          type="button"
          title="Faster"
          onClick={() => setSpeed(settings.speed + SPEED_STEP)}
        >
          +
        </button>
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
        {SPEED_CHIPS.map((chip) => (
          <button
            type="button"
            key={chip}
            class={Math.abs(chip - settings.speed) < 0.001 ? "chip on" : "chip"}
            onClick={() => setSpeed(chip)}
          >
            {formatRate(chip)}
          </button>
        ))}
      </div>
      <div class="status">{statusText(session, rate)}</div>
    </div>
  );
}

function statusText(session: VideoSpeedSession, rate: number): string {
  const playing = `playing ${formatRate(rate)}`;
  if (!session.settings.value.auto) return playing;
  switch (session.status.value) {
    case "needs-click":
      return "click the page to start listening";
    case "unavailable":
      return `can't hear this media · fixed ${playing}`;
    case "paused":
      return `paused · ${playing}`;
    case "off":
    case "listening": {
      const speaker = session.speakerRate.value;
      if (speaker === undefined) return `listening… · ${playing}`;
      const confidence = Math.round(session.confidence.value * 100);
      return `speaker ${speaker.toFixed(1)} syl/s (${confidence}%) · ${playing}`;
    }
  }
}

function dotClass(auto: boolean, status: DetectionStatus): string {
  if (!auto) return "manual";
  return status === "listening"
    ? "listening"
    : status === "unavailable"
      ? "unavailable"
      : "waiting";
}

function formatRate(rate: number): string {
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
