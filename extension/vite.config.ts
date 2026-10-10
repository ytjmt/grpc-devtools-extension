import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = new URL(".", import.meta.url).pathname;

export default defineConfig({
  root,
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // DevTools extension pages cannot load inline/eval'd code under the default CSP.
    modulePreload: false,
    rollupOptions: {
      input: { devtools: `${root}devtools.html`, panel: `${root}panel.html` },
    },
  },
});
