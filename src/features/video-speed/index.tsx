import { computed, effect, type ReadonlySignal, signal } from "@preact/signals";
import { render } from "preact";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import {
  createShadowRootUi,
  type ShadowRootContentScriptUi,
} from "wxt/utils/content-script-ui/shadow-root";
import { trackActiveMedia } from "./media-tracker";
import { VideoSpeedPill } from "./pill";
import pillCss from "./pill.css?inline";
import { serveRemoteControl } from "./remote-control";
import { VideoSpeedSession } from "./session";
import { type PillState, pillStateItem } from "./settings";

/**
 * Runs on every page and frame, so it does nothing until a media element
 * worth controlling shows up; only then does it read settings. The pill is
 * built only once the user moves off 1× fixed (from the toolbar popup), and
 * hides again when they go back to it.
 */
export function startVideoSpeed(ctx: ContentScriptContext): () => void {
  let session: VideoSpeedSession | undefined;
  let ui: Promise<ShadowRootContentScriptUi<void>> | undefined;
  let stopMounting: (() => void) | undefined;
  // A bare <video> in fullscreen can't hold children, so the pill can't show.
  const bareMediaFullscreen = signal(false);

  const stopTracking = trackActiveMedia((media) => {
    if (media && !session) {
      const created = new VideoSpeedSession();
      session = created;
      void created.start();
      const visible = computed(
        () =>
          created.engaged.value &&
          created.media.value !== null &&
          !bareMediaFullscreen.value,
      );
      stopMounting = effect(() => {
        if (visible.value && !ui) ui = mountPill(ctx, created, visible);
      });
    }
    if (session) session.media.value = media;
  });
  const stopServing = serveRemoteControl(() => session);

  // The pill must live inside the fullscreen element to stay visible.
  const onFullscreenChange = () => {
    const fullscreen = document.fullscreenElement;
    bareMediaFullscreen.value = fullscreen instanceof HTMLMediaElement;
    void ui?.then(({ shadowHost }) => {
      if (fullscreen && !(fullscreen instanceof HTMLMediaElement)) {
        fullscreen.append(shadowHost);
      } else if (shadowHost.parentElement !== document.body) {
        document.body.append(shadowHost);
      }
    });
  };
  document.addEventListener("fullscreenchange", onFullscreenChange);

  return () => {
    stopTracking();
    stopServing();
    stopMounting?.();
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    session?.dispose();
    void ui?.then((mounted) => mounted.remove());
  };
}

async function mountPill(
  ctx: ContentScriptContext,
  session: VideoSpeedSession,
  visible: ReadonlySignal<boolean>,
): Promise<ShadowRootContentScriptUi<void>> {
  const state = await pillStateItem.getValue();
  const origin = location.origin;
  const save = async (patch: (state: PillState) => PillState) =>
    pillStateItem.setValue(patch(await pillStateItem.getValue()));

  const ui = await createShadowRootUi(ctx, {
    name: "video-speed-pill",
    css: pillCss,
    position: "inline",
    anchor: "body",
    // Keys typed into the pill must not trigger site shortcuts (YouTube's
    // space-to-pause, for one).
    isolateEvents: ["keydown", "keyup", "keypress"],
    onMount: (container) => {
      // Hiding happens inside the shadow root: WXT's `:host { all: initial
      // !important }` reset beats `hidden` or inline styles on the host.
      render(
        <VideoSpeedPill
          session={session}
          visible={visible}
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
