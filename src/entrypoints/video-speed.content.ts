import { defineContentScript } from "wxt/utils/define-content-script";
import { startVideoSpeed } from "../features/video-speed";
import { runFeatureWhileEnabled } from "../platform/feature-settings";

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  runAt: "document_idle",
  cssInjectionMode: "ui",
  main: (ctx) =>
    runFeatureWhileEnabled(ctx, "videoSpeed", () => startVideoSpeed(ctx)),
});
