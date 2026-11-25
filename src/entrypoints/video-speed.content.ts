import { defineContentScript } from "wxt/utils/define-content-script";
import { startVideoSpeed } from "../features/video-speed";
import { runFeatureWhileEnabled } from "../platform/feature-settings";

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  runAt: "document_idle",
  // The pill bundles its CSS (pill.css?inline) instead of fetching it: some
  // sites, music.youtube.com among them, block that fetch.
  cssInjectionMode: "manual",
  main: (ctx) =>
    runFeatureWhileEnabled(ctx, "videoSpeed", () => startVideoSpeed(ctx)),
});
