import { browser } from "wxt/browser";
import type {
  DetectionStatus,
  SpeedControlPatch,
  VideoSpeedSession,
} from "./session";
import type { SpeedMode } from "./settings";

/**
 * The toolbar popup and a page's session talk over tab messages. A message
 * to a tab reaches every frame, and the first frame to answer wins, so only
 * frames holding media answer, and a frame whose media is paused waits a
 * moment so a playing one elsewhere on the page wins.
 */

export type VideoSpeedSnapshot = {
  sessionId: string;
  mode: SpeedMode;
  speed: number;
  fixedOverride: boolean;
  quickSpeed: number;
  playbackRate: number;
  playing: boolean;
  status: DetectionStatus;
  speakerRate: number | undefined;
  confidence: number;
};

export type VideoSpeedRequest =
  | { type: "videoSpeed/find" }
  | { type: "videoSpeed/get"; sessionId: string }
  | {
      type: "videoSpeed/set";
      sessionId: string;
      patch: SpeedControlPatch;
    };

const PAUSED_FRAME_DELAY_MS = 150;

export function snapshotSession(
  session: VideoSpeedSession,
): VideoSpeedSnapshot {
  const media = session.media.peek();
  return {
    sessionId: session.id,
    mode: session.mode.peek(),
    speed: session.speed.peek(),
    fixedOverride: session.fixedOverride.peek(),
    quickSpeed: session.prefs.peek().quickSpeed,
    playbackRate: session.playbackRate.peek(),
    playing: media ? !media.paused : false,
    status: session.status.peek(),
    speakerRate: session.speakerRate.peek(),
    confidence: session.confidence.peek(),
  };
}

/** Content-script side: answers the popup for this frame's session. */
export function serveRemoteControl(
  getSession: () => VideoSpeedSession | undefined,
): () => void {
  const listener = (
    message: unknown,
    _sender: unknown,
    sendResponse: (response: VideoSpeedSnapshot) => void,
  ) => {
    const request = message as VideoSpeedRequest;
    const session = getSession();
    const media = session?.media.peek();
    if (!session || !media || !request.type?.startsWith("videoSpeed/")) {
      return false;
    }
    if (request.type === "videoSpeed/find") {
      if (!media.paused) {
        sendResponse(snapshotSession(session));
        return false;
      }
      setTimeout(
        () => sendResponse(snapshotSession(session)),
        PAUSED_FRAME_DELAY_MS,
      );
      return true;
    }
    if (request.sessionId !== session.id) return false;
    if (request.type === "videoSpeed/set") session.setControl(request.patch);
    sendResponse(snapshotSession(session));
    return false;
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}

/** Popup side. Resolves to undefined when no frame in the tab has media. */
export async function requestVideoSpeed(
  tabId: number,
  request: VideoSpeedRequest,
): Promise<VideoSpeedSnapshot | undefined> {
  try {
    return (await browser.tabs.sendMessage(tabId, request)) as
      | VideoSpeedSnapshot
      | undefined;
  } catch {
    // No receiver: a page without media, a browser page, or the feature off.
    return undefined;
  }
}
