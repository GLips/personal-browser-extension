import preact from "@preact/preset-vite";
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  manifest: {
    name: "Personal Browser Extension",
    description: "Graham's personal browser features.",
    permissions: ["storage"],
  },
  vite: () => ({ plugins: [preact()] }),
});
