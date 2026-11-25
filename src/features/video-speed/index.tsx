import { render } from "preact";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import {
  createShadowRootUi,
  type ShadowRootContentScriptUi,
} from "wxt/utils/content-script-ui/shadow-root";
import { trackActiveMedia } from "./media-tracker";
import { VideoSpeedPill } from "./pill";
import "./pill.css";
import { VideoSpeedSession } from "./session";
import { type PillState, pillStateItem } from "./settings";

/**
 * Runs on every page and frame, so it does nothing until a media element
 * worth controlling shows up; only then does it read settings and build UI.
 */
export function startVideoSpeed(ctx: ContentScriptContext): () => void {
  let session: VideoSpeedSession | undefined;
  let ui: Promise<ShadowRootContentScriptUi<void>> | undefined;
  let disposed = false;

  const stopTracking = trackActiveMedia((media) => {
    if (media && !session) {
      session = new VideoSpeedSession();
      void session.start();
      ui = mountPill(ctx, session);
    }
    if (session) session.media.value = media;
    void ui?.then((mounted) => {
      if (!disposed) mounted.shadowHost.hidden = media === null;
    });
  });

  // The pill must live inside the fullscreen element to stay visible. A bare
  // <video> in fullscreen can't hold children, so it hides then.
  const onFullscreenChange = () =>
    void ui?.then(({ shadowHost }) => {
      const fullscreen = document.fullscreenElement;
      if (fullscreen && !(fullscreen instanceof HTMLMediaElement)) {
        fullscreen.append(shadowHost);
      } else if (shadowHost.parentElement !== document.body) {
        document.body.append(shadowHost);
      }
      shadowHost.style.display =
        fullscreen instanceof HTMLMediaElement ? "none" : "";
    });
  document.addEventListener("fullscreenchange", onFullscreenChange);

  return () => {
    disposed = true;
    stopTracking();
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    session?.dispose();
    void ui?.then((mounted) => mounted.remove());
  };
}

async function mountPill(
  ctx: ContentScriptContext,
  session: VideoSpeedSession,
): Promise<ShadowRootContentScriptUi<void>> {
  const state = await pillStateItem.getValue();
  const origin = location.origin;
  const save = async (patch: (state: PillState) => PillState) =>
    pillStateItem.setValue(patch(await pillStateItem.getValue()));

  const ui = await createShadowRootUi(ctx, {
    name: "video-speed-pill",
    position: "inline",
    anchor: "body",
    // Keys typed into the pill must not trigger site shortcuts (YouTube's
    // space-to-pause, for one).
    isolateEvents: ["keydown", "keyup", "keypress"],
    onMount: (container) => {
      render(
        <VideoSpeedPill
          session={session}
          initialPosition={
            state.positionsByOrigin[origin] ?? state.defaultPosition
          }
          initialCollapsed={state.collapsed}
          onPositionChange={(position) =>
            save((s) => ({
              ...s,
              defaultPosition: position,
              positionsByOrigin: { ...s.positionsByOrigin, [origin]: position },
            }))
          }
          onCollapsedChange={(collapsed) => save((s) => ({ ...s, collapsed }))}
        />,
        container,
      );
    },
    onRemove: () => {
      render(null, ui.uiContainer);
    },
  });
  ui.mount();
  return ui;
}
