import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { storage } from "wxt/utils/storage";

export type FeatureId = "gmailSnooze" | "videoSpeed";

export type FeatureInfo = { id: FeatureId; title: string; description: string };

// Every feature the options page lists. A feature missing here still runs,
// but can't be switched off.
export const featureCatalog: FeatureInfo[] = [
  {
    id: "gmailSnooze",
    title: "Gmail natural-language snooze",
    description: 'Type "tomorrow 9am" into Gmail\'s snooze menu.',
  },
  {
    id: "videoSpeed",
    title: "Video speed",
    description:
      "A floating speed control on any page with video or audio; Auto evens out fast and slow speakers.",
  },
];

function defineFeatureEnabledItem(id: FeatureId) {
  return storage.defineItem<boolean>(`sync:feature.${id}.enabled`, {
    fallback: true,
  });
}

const enabledItems = new Map<
  FeatureId,
  ReturnType<typeof defineFeatureEnabledItem>
>();

export function featureEnabledItem(id: FeatureId) {
  let item = enabledItems.get(id);
  if (!item) {
    item = defineFeatureEnabledItem(id);
    enabledItems.set(id, item);
  }
  return item;
}

/**
 * Runs `start` while the feature is enabled, and calls the disposer it
 * returns when the feature is switched off or the content script is
 * invalidated (extension reload). Toggling takes effect without a page reload.
 */
export async function runFeatureWhileEnabled(
  ctx: ContentScriptContext,
  id: FeatureId,
  start: () => () => void,
) {
  const item = featureEnabledItem(id);
  let stop: (() => void) | undefined;
  const apply = (enabled: boolean) => {
    if (enabled && !stop) stop = start();
    if (!enabled && stop) {
      stop();
      stop = undefined;
    }
  };
  apply(await item.getValue());
  const unwatch = item.watch(apply);
  ctx.onInvalidated(() => {
    unwatch();
    apply(false);
  });
}
