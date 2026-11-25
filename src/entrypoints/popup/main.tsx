import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import { SKIP_SECONDS } from "../../features/video-speed/catch-up";
import { formatRate } from "../../features/video-speed/pill";
import {
  requestVideoSpeed,
  type VideoSpeedRequest,
  type VideoSpeedSnapshot,
} from "../../features/video-speed/remote-control";
import type { SpeedControlPatch } from "../../features/video-speed/session";
import {
  HOTKEY_SPEED,
  SPEED_CHOICES,
  SPEED_STEP,
} from "../../features/video-speed/settings";
import {
  formatClock,
  formatDuration,
  localDay,
  todaysWatchSeconds,
  type WatchSeconds,
  type WatchTotals,
  watchTotalsItem,
} from "../../features/video-speed/time-saved";
import "./style.css";

// Frequent enough that the playing rate looks live while the popup is open;
// it closes as soon as focus leaves, so the cost is bounded.
const REFRESH_MS = 500;

function VideoSpeedPopup({ tabId }: { tabId: number }) {
  const [snapshot, setSnapshot] = useState<VideoSpeedSnapshot | undefined>();
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    let current: VideoSpeedSnapshot | undefined;
    const refresh = async () => {
      const request: VideoSpeedRequest = current
        ? { type: "videoSpeed/get", sessionId: current.sessionId }
        : { type: "videoSpeed/find" };
      // A session can vanish (navigation, media removed): look again.
      current =
        (await requestVideoSpeed(tabId, request)) ??
        (current
          ? await requestVideoSpeed(tabId, { type: "videoSpeed/find" })
          : undefined);
      setSnapshot(current);
      setSearched(true);
    };
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [tabId]);

  if (!searched) return <main />;
  if (!snapshot) {
    return (
      <main>
        <p class="empty">No video or audio on this page.</p>
        <ShortcutHint />
      </main>
    );
  }

  const control = async (patch: SpeedControlPatch) => {
    const next = await requestVideoSpeed(tabId, {
      type: "videoSpeed/set",
      sessionId: snapshot.sessionId,
      patch,
    });
    if (next) setSnapshot(next);
  };
  const skip = async (seconds: number) => {
    const next = await requestVideoSpeed(tabId, {
      type: "videoSpeed/skip",
      sessionId: snapshot.sessionId,
      seconds,
    });
    if (next) setSnapshot(next);
  };
  const { speed, quickSpeed } = snapshot;
  const choices = SPEED_CHOICES.includes(quickSpeed)
    ? SPEED_CHOICES
    : [...SPEED_CHOICES, quickSpeed].sort((a, b) => a - b);

  return (
    <main>
      <div class={snapshot.replaying ? "rate replaying" : "rate"}>
        {formatRate(shownRate(snapshot))}
        {snapshot.boosting && (
          <span class="boost" title="Playing a pause fast">
            ⏩
          </span>
        )}
      </div>
      <div class="detail">{detailText(snapshot)}</div>
      <WatchStats snapshot={snapshot} />
      <div class="skips">
        <button
          type="button"
          title="Replayed slower, with captions where available"
          onClick={() => skip(-SKIP_SECONDS)}
        >
          ⟲ Back {SKIP_SECONDS}s
        </button>
        <button type="button" onClick={() => skip(SKIP_SECONDS)}>
          Forward {SKIP_SECONDS}s ⟳
        </button>
      </div>
      {speed === 1 && (
        <button
          type="button"
          class="quick"
          onClick={() => control({ speed: quickSpeed })}
        >
          Speed up to {formatRate(quickSpeed)}
        </button>
      )}
      <div class="chips">
        {choices.map((choice) => (
          <button
            type="button"
            key={choice}
            class={Math.abs(choice - speed) < 0.001 ? "chip on" : "chip"}
            onClick={() => control({ speed: choice })}
          >
            {formatRate(choice)}
          </button>
        ))}
      </div>
      <div class="adjust">
        <button
          type="button"
          title="Slower"
          onClick={() => control({ speed: speed - SPEED_STEP })}
        >
          −
        </button>
        <span>{formatRate(speed)}</span>
        <button
          type="button"
          title="Faster"
          onClick={() => control({ speed: speed + SPEED_STEP })}
        >
          +
        </button>
      </div>
      <label class="override">
        <input
          type="checkbox"
          checked={snapshot.skipSilences}
          onChange={(e) => control({ skipSilences: e.currentTarget.checked })}
        />
        Speed through silences (pauses play at 4× while sped up)
      </label>
      <label class="override">
        <input
          type="checkbox"
          checked={snapshot.fixedOverride}
          onChange={(e) => control({ fixedOverride: e.currentTarget.checked })}
        />
        Fixed speed (ignore how fast the speaker talks)
      </label>
      <ShortcutHint />
    </main>
  );
}

/**
 * The rate to show: during a silence boost, the speech rate, so the big
 * number doesn't flicker to 4× on every pause.
 */
function shownRate(s: VideoSpeedSnapshot): number {
  return s.boosting ? s.speechRate : s.playbackRate;
}

function WatchStats({ snapshot }: { snapshot: VideoSpeedSnapshot }) {
  const [totals, setTotals] = useState<WatchTotals | undefined>();
  useEffect(() => {
    void watchTotalsItem.getValue().then(setTotals);
    return watchTotalsItem.watch(setTotals);
  }, []);
  const remaining = snapshot.duration - snapshot.currentTime;
  const endsIn = Number.isFinite(remaining)
    ? `Ends in ${formatClock(remaining / shownRate(snapshot))}${shownRate(snapshot) === 1 ? "" : " at this speed"}`
    : undefined;
  // The page flushes its seconds every 15 s; until then they're only in
  // the snapshot's per-video count, so today/all-time can trail slightly.
  const today = totals && todaysWatchSeconds(totals, localDay());
  const line = (label: string, s: WatchSeconds | undefined, clock: boolean) => {
    const format = clock ? formatClock : formatDuration;
    return (
      <div>
        {label}: watched {format(s?.watched ?? 0)} · saved{" "}
        {format(s?.saved ?? 0)}
      </div>
    );
  };
  return (
    <div class="saved">
      {endsIn && <div>{endsIn}</div>}
      {line("This video", snapshot.thisVideo, true)}
      {line("Today", today, false)}
      {line("All time", totals?.allTime, false)}
    </div>
  );
}

function ShortcutHint() {
  const [toggleKey, setToggleKey] = useState<string | undefined>();
  useEffect(() => {
    void browser.commands.getAll().then((commands) => {
      const toggle = commands.find((c) => c.name === "video-speed-toggle");
      setToggleKey(toggle?.shortcut || undefined);
    });
  }, []);
  // chrome:// links can't be opened by a plain anchor from an extension page.
  const openShortcuts = () =>
    void browser.tabs.create({ url: "chrome://extensions/shortcuts" });
  return (
    <p class="hint">
      {toggleKey ? `${toggleKey} toggles ${HOTKEY_SPEED}× / 1×. ` : ""}
      <button type="button" class="link" onClick={openShortcuts}>
        Set shortcuts
      </button>{" "}
      (incl. skip back/forward)
    </p>
  );
}

function detailText(s: VideoSpeedSnapshot): string {
  const text = baseDetailText(s);
  if (s.replaying) return `${text} · replaying slower`;
  if (s.boosting) return `${text} · skipping a pause`;
  return text;
}

function baseDetailText(s: VideoSpeedSnapshot): string {
  if (s.speed === 1) return "Normal speed";
  if (s.mode === "fixed") return `Fixed at ${formatRate(s.speed)}`;
  const target = `Relative ${formatRate(s.speed)}`;
  switch (s.status) {
    case "needs-click":
      return `${target} · click the page to start listening`;
    case "unavailable":
      return `${target} · can't hear this media, holding speed`;
    case "paused":
      return `${target} · paused`;
    case "off":
    case "listening":
      if (s.speakerRate === undefined) return `${target} · listening…`;
      return `${target} · speaker ${s.speakerRate.toFixed(1)} syl/s (${Math.round(s.confidence * 100)}%)`;
  }
}

const root = document.getElementById("app");
if (!root) throw new Error("popup is missing #app");
const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
if (tab?.id === undefined)
  throw new Error("popup opened without an active tab");
render(<VideoSpeedPopup tabId={tab.id} />, root);
