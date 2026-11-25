<p align="center">
  <img src="assets/logo.png" width="240" height="240" alt="Personal Browser Extension mascot: a deadpan orange hawk in wraparound sunglasses">
</p>

# Personal Browser Extension

A Chrome extension of small, independent features for my own browsing. Each feature lives in its own module, runs only on the sites it needs, and can be switched off from the options page. It is loaded unpacked and never published.

## Features

- **Gmail natural-language snooze.** Type "tomorrow 9am" or "next Monday" into Gmail's snooze menu instead of using the date picker.
- **Video speed.** Pick a speed from the toolbar button. Every page starts at true 1×; any faster speed is relative, adjusting playback to how fast the speaker talks so everyone lands at the same pace (a "fixed speed" checkbox gives a plain rate instead). While sped up, a small draggable pill on the page shows the actual playback rate, quick speed choices with −/+, and ⟲/⟳ 10s skips (a skip back replays that stretch slower, with captions). ⌘⇧L (Ctrl+Shift+L elsewhere) toggles 3× relative / 1×; skip back/forward have commands you can bind at `chrome://extensions/shortcuts`.

## Daily use

```sh
bun install
bun run build
```

In `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick `.output/chrome-mv3`. After a rebuild, click the extension's reload button.

## Development

```sh
bun run dev
```

Load `.output/chrome-mv3-dev` unpacked the same way. It shows up as **Personal Browser Extension (dev)** and reloads itself, and any open tabs it runs in, whenever a file changes, as long as `bun run dev` is running. Its options page needs the dev server, so don't use the dev copy day to day.

Keep only one of the two copies enabled at a time; with both on, every feature runs twice. Chrome gives each copy its own extension ID, so settings don't carry between them.

## Layout

- `src/entrypoints/`: thin WXT entrypoints. Each content script declares its own match patterns and starts one feature.
- `src/features/<name>/`: each feature's code, framework-independent where possible.
- `src/platform/`: shared pieces, such as per-feature on/off settings synced through `chrome.storage.sync`.
- `assets/logo.png`: the mascot master; `assets/logo-head.png` is the head-only crop used for the 16 and 32 px toolbar icons. `public/icon/` holds the rendered icon PNGs.

## Checks

```sh
bun run typecheck
bun run lint
bun run test
```
