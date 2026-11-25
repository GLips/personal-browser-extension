import { computed, signal } from "@preact/signals";
import { render } from "preact";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { parseSnoozeInput } from "./date-parser";
import { isShown, isSnoozeMenu, SNOOZE_MENU_SELECTOR } from "./gmail-dom";
import { snoozeThroughPickDateDialog } from "./snooze-automation";
import {
  type PanelPhase,
  type PanelPlacement,
  SnoozePanel,
  snoozePanelCss,
} from "./snooze-panel";

/**
 * Lets you type a snooze time while Gmail's Snooze menu is open: press `b`
 * (or click Snooze), type "fri 3pm", hit Enter. Keystrokes are intercepted
 * rather than sent to an input, because moving focus out of Gmail's menu
 * closes it, and the menu has to stay open for its "Pick date & time" item.
 */
export function startGmailSnooze(ctx: ContentScriptContext): () => void {
  let session: SnoozeSession | undefined;

  const openFor = (menu: HTMLElement) => {
    if (session?.isSnoozing()) return;
    session?.close();
    const opened = openSnoozeSession(ctx, menu, () => {
      if (session === opened) session = undefined;
    });
    session = opened;
  };

  // Gmail mounts its menus as direct children of <body>, so watching body's
  // own children is enough; a subtree observer on Gmail would fire constantly.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (isSnoozeMenu(node)) openFor(node);
      }
    }
  });
  observer.observe(document.body, { childList: true });
  const existing = document.querySelector<HTMLElement>(SNOOZE_MENU_SELECTOR);
  if (existing && isShown(existing)) openFor(existing);

  return () => {
    observer.disconnect();
    session?.close();
  };
}

type SnoozeSession = { close: () => void; isSnoozing: () => boolean };

function openSnoozeSession(
  ctx: ContentScriptContext,
  menu: HTMLElement,
  onClosed: () => void,
): SnoozeSession {
  const text = signal("");
  const parse = computed(() => parseSnoozeInput(text.value));
  const phase = signal<PanelPhase>({ kind: "typing" });
  const placement = signal(placeBeside(menu));
  let closed = false;
  let failureTimer: ReturnType<typeof setTimeout> | undefined;

  const uiPromise = createShadowRootUi(ctx, {
    name: "pbe-gmail-snooze",
    position: "inline",
    anchor: "body",
    css: snoozePanelCss,
    onMount: (container) => {
      render(
        <SnoozePanel
          text={text}
          parse={parse}
          phase={phase}
          placement={placement}
        />,
        container,
      );
      return container;
    },
    onRemove: (container) => {
      if (container) render(null, container);
    },
  });
  uiPromise.then((ui) => (closed ? undefined : ui.mount()));
  // Gmail positions the menu a frame after inserting it.
  requestAnimationFrame(() => {
    placement.value = placeBeside(menu);
  });

  const menuOpen = () => isShown(menu);

  const onKeyDown = (event: KeyboardEvent) => {
    if (phase.value.kind === "failed") return close();
    if (phase.value.kind !== "typing" || !menuOpen() || event.isComposing) {
      return;
    }
    const swallow = () => {
      // Cancelling keydown also suppresses keypress; keyup is swallowed
      // separately so no Gmail shortcut sees any part of the keystroke.
      event.preventDefault();
      event.stopImmediatePropagation();
      swallowedKeys.add(event.code);
    };

    if (event.key === "Backspace") {
      swallow();
      text.value = event.metaKey
        ? ""
        : event.altKey
          ? text.value.replace(/\S+\s*$/, "")
          : text.value.slice(0, -1);
    } else if (event.key === "Escape" && text.value) {
      swallow();
      text.value = "";
    } else if (event.key === "Enter" && text.value) {
      swallow();
      const result = parse.value;
      if (result.kind === "ok") void submit(result.date);
    } else if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      // Every printable key, including Gmail shortcuts like `e` (archive)
      // and `#` (delete): while the menu is open they're text, not commands.
      swallow();
      text.value += event.key;
    }
  };

  const swallowedKeys = new Set<string>();
  const onKeyUp = (event: KeyboardEvent) => {
    if (!swallowedKeys.delete(event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onPaste = (event: ClipboardEvent) => {
    if (phase.value.kind !== "typing" || !menuOpen()) return;
    const pasted = event.clipboardData?.getData("text/plain");
    if (!pasted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    text.value += pasted.replace(/\s+/g, " ");
  };

  // Gmail removes the menu when it closes (Escape, outside click, a preset).
  const menuWatcher = new MutationObserver(() => {
    if (!menuOpen() && phase.value.kind === "typing") close();
  });
  menuWatcher.observe(document.body, { childList: true });
  menuWatcher.observe(menu, { attributes: true, attributeFilter: ["style"] });

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("paste", onPaste, true);
  window.addEventListener("mousedown", onMouseDown, true);

  function onMouseDown() {
    if (phase.value.kind === "failed") close();
  }

  async function submit(date: Date) {
    phase.value = { kind: "snoozing" };
    try {
      await snoozeThroughPickDateDialog(menu, date);
      close();
    } catch (error) {
      phase.value = {
        kind: "failed",
        message: `${error instanceof Error ? error.message : "Snooze failed"}. Finish it in Gmail's dialog.`,
      };
      failureTimer = setTimeout(close, 8000);
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(failureTimer);
    menuWatcher.disconnect();
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("paste", onPaste, true);
    window.removeEventListener("mousedown", onMouseDown, true);
    uiPromise.then((ui) => ui.remove());
    onClosed();
  }

  return { close, isSnoozing: () => phase.value.kind === "snoozing" };
}

const GAP = 8;
const PANEL_HEIGHT_ESTIMATE = 72;

function placeBeside(menu: HTMLElement): PanelPlacement {
  const rect = menu.getBoundingClientRect();
  const style = getComputedStyle(menu);
  const fitsBelow =
    rect.bottom + GAP + PANEL_HEIGHT_ESTIMATE < window.innerHeight;
  return {
    left: rect.left,
    width: Math.max(rect.width, 260),
    ...(fitsBelow
      ? { top: rect.bottom + GAP }
      : { bottom: window.innerHeight - rect.top + GAP }),
    background: style.backgroundColor,
    color: style.color,
  };
}
