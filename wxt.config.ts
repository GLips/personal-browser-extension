import preact from "@preact/preset-vite";
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  // The dev build gets its own name so it's distinguishable from the daily
  // build when both are loaded unpacked in the same Chrome.
  manifest: ({ command }) => ({
    name:
      command === "serve"
        ? "Personal Browser Extension (dev)"
        : "Personal Browser Extension",
    description: "Graham's personal browser features.",
    permissions: ["storage"],
    // Skip commands ship unbound: every free combo clashes with something
    // (text selection, site shortcuts). Bind them at chrome://extensions/shortcuts.
    commands: {
      "video-speed-toggle": {
        suggested_key: { default: "Ctrl+Shift+L", mac: "Command+Shift+L" },
        description: "Video speed: toggle 3× relative / 1×",
      },
      "video-speed-back": {
        description: "Video speed: back 10s (replayed slower)",
      },
      "video-speed-forward": { description: "Video speed: forward 10s" },
    },
  }),
  vite: () => ({ plugins: [preact()] }),
});
