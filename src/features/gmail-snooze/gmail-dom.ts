// Gmail's DOM, as observed Nov 2026. Gmail's class names are minified and
// churn; these lean on ARIA roles and labels, which have held for years.

export const SNOOZE_MENU_SELECTOR = '[role="menu"][aria-label="Snooze menu"]';
const PICK_DATE_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]';

export function isSnoozeMenu(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && node.matches(SNOOZE_MENU_SELECTOR);
}

// offsetParent would be null for fixed-position elements even when visible.
export function isShown(element: HTMLElement): boolean {
  return element.isConnected && element.getClientRects().length > 0;
}

export function findPickDateMenuItem(menu: HTMLElement): HTMLElement | null {
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  // Gmail always lists "Pick date & time" last; the text match is for English
  // and the fallback covers other locales.
  return (
    items.find((item) => item.textContent?.includes("Pick date & time")) ??
    items.at(-1) ??
    null
  );
}

export function findPickDateDialog(): HTMLElement | null {
  for (const dialog of document.querySelectorAll<HTMLElement>(
    PICK_DATE_DIALOG_SELECTOR,
  )) {
    if (dialog.querySelector('input[aria-label="Date"]')) return dialog;
  }
  return null;
}

export function pickDateDialogParts(dialog: HTMLElement) {
  return {
    dateInput: dialog.querySelector<HTMLInputElement>(
      'input[aria-label="Date"]',
    ),
    timeInput: dialog.querySelector<HTMLInputElement>(
      'input[aria-label="Time"]',
    ),
    saveButton: dialog.querySelector<HTMLElement>(
      'button[data-mdc-dialog-action="ok"]',
    ),
  };
}

/** Gmail's menus act on mousedown/mouseup, not `click`, so send all three. */
export function activateGmailControl(target: HTMLElement) {
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
  };
  target.dispatchEvent(new MouseEvent("mouseover", init));
  target.dispatchEvent(new MouseEvent("mousedown", init));
  target.dispatchEvent(new MouseEvent("mouseup", init));
  target.dispatchEvent(new MouseEvent("click", init));
}

/**
 * Sets a Gmail text field the way typing would: Gmail parses the value on
 * change and blur (the calendar jumps to the typed month), so both must fire.
 */
export function fillGmailField(input: HTMLInputElement, value: string) {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.blur();
}

/** Resolves with `check()`'s first non-null result, or null after `timeoutMs`. */
export function waitForDom<T>(
  check: () => T | null,
  timeoutMs: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const first = check();
    if (first !== null) return resolve(first);
    const observer = new MutationObserver(() => {
      const found = check();
      if (found !== null) finish(found);
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
    function finish(value: T | null) {
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    }
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  });
}
