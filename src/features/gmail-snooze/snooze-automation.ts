import {
  activateGmailControl,
  fillGmailField,
  findPickDateDialog,
  findPickDateMenuItem,
  pickDateDialogParts,
  waitForDom,
} from "./gmail-dom";
import { formatDateForGmail, formatTimeForGmail } from "./gmail-format";

export class SnoozeAutomationError extends Error {}

const HIDE_DIALOG_ATTR = "data-pbe-snoozing";
// Hides the fixed-position container Gmail mounts the dialog in. It has no
// separate backdrop, so this is the only thing that would flash on screen.
const HIDE_DIALOG_CSS = `html[${HIDE_DIALOG_ATTR}] body > div:has([role="dialog"][aria-modal="true"] input[aria-label="Date"]) { opacity: 0 !important; }`;

/**
 * Snoozes through Gmail's own "Pick date & time" dialog, so Gmail does the
 * real work and shows its usual "Snoozed" toast with Undo. The dialog is
 * hidden while we drive it; on failure it's revealed with whatever we managed
 * to fill in, so the user can finish by hand.
 */
export async function snoozeThroughPickDateDialog(
  menu: HTMLElement,
  date: Date,
): Promise<void> {
  const item = findPickDateMenuItem(menu);
  if (!item) throw new SnoozeAutomationError("Couldn't find Pick date & time");

  const style = document.createElement("style");
  style.textContent = HIDE_DIALOG_CSS;
  document.head.append(style);
  document.documentElement.setAttribute(HIDE_DIALOG_ATTR, "");
  try {
    activateGmailControl(item);
    const dialog = await waitForDom(findPickDateDialog, 3000);
    if (!dialog)
      throw new SnoozeAutomationError("Gmail's date dialog didn't open");

    const { dateInput, timeInput, saveButton } = pickDateDialogParts(dialog);
    if (!dateInput || !timeInput || !saveButton) {
      throw new SnoozeAutomationError("Gmail's date dialog changed shape");
    }
    fillGmailField(dateInput, formatDateForGmail(date, dateInput.value));
    fillGmailField(timeInput, formatTimeForGmail(date, timeInput.value));
    saveButton.click();

    const closed = await waitForDom(
      () => (findPickDateDialog() ? null : true),
      3000,
    );
    if (!closed) {
      throw new SnoozeAutomationError("Gmail didn't accept that time");
    }
  } finally {
    document.documentElement.removeAttribute(HIDE_DIALOG_ATTR);
    style.remove();
  }
}
