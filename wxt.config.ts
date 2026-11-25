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
  }),
  vite: () => ({ plugins: [preact()] }),
});
