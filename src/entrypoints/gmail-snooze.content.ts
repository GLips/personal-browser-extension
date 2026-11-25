import { defineContentScript } from "wxt/utils/define-content-script";
import { startGmailSnooze } from "../features/gmail-snooze";
import { runFeatureWhileEnabled } from "../platform/feature-settings";

export default defineContentScript({
  matches: ["https://mail.google.com/*"],
  runAt: "document_idle",
  main: (ctx) => runFeatureWhileEnabled(ctx, "gmailSnooze", startGmailSnooze),
});
