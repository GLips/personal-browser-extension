import { observeSnoozeMenu } from "./dom-observer";
import { injectSnoozeInput } from "./ui-injector";

export function startGmailSnooze(): () => void {
  return observeSnoozeMenu(injectSnoozeInput);
}
