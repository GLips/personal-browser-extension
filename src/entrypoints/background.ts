import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { SKIP_SECONDS } from "../features/video-speed/catch-up";
import { sendVideoSpeedCommand } from "../features/video-speed/remote-control";

// Keyboard commands from the manifest's `commands`; bindings are editable at
// chrome://extensions/shortcuts.
export default defineBackground(() => {
  browser.commands.onCommand.addListener(async (command, tab) => {
    const tabId =
      tab?.id ??
      (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (tabId === undefined) return;
    if (command === "video-speed-toggle") {
      await sendVideoSpeedCommand(tabId, { type: "toggle" });
    } else if (command === "video-speed-back") {
      await sendVideoSpeedCommand(tabId, {
        type: "skip",
        seconds: -SKIP_SECONDS,
      });
    } else if (command === "video-speed-forward") {
      await sendVideoSpeedCommand(tabId, {
        type: "skip",
        seconds: SKIP_SECONDS,
      });
    }
  });
});
