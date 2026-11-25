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
        {formatRate(snapshot.playbackRate)}
      </div>
      <div class="detail">{detailText(snapshot)}</div>
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
          checked={snapshot.fixedOverride}
          onChange={(e) => control({ fixedOverride: e.currentTarget.checked })}
        />
        Fixed speed (ignore how fast the speaker talks)
      </label>
      <ShortcutHint />
    </main>
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
  return s.replaying ? `${text} · replaying slower` : text;
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
