<p align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="Personal Browser Extension logo: two slider knobs on an orange tile">
</p>

# Personal Browser Extension

A Chrome extension of small, independent features for my own browsing. Each feature lives in its own module, runs only on the sites it needs, and can be switched off from the options page. It is loaded unpacked and never published.

## Features

- **Gmail natural-language snooze.** Type "tomorrow 9am" or "next Monday" into Gmail's snooze menu instead of using the date picker.
- **Video speed.** A floating widget on any page with video or audio that measures how fast the speaker talks and adjusts playback speed to hit a target rate, with quick relative-speed presets.

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
- `assets/logo.svg`: the logo master; `assets/logo-16.svg` is a pixel-fitted version for the 16 px toolbar icon. `public/icon/` holds the rendered PNGs.

## Checks

```sh
bun run typecheck
bun run lint
bun run test
```
