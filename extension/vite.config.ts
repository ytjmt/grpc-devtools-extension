import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const root = new URL(".", import.meta.url).pathname;

/** Emits manifest.json with the version from package.json, the single source of truth. */
function manifest(): Plugin {
  return {
    name: "manifest",
    generateBundle() {
      const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
      // Chrome accepts 1-4 dot-separated integers only (no pre-release suffixes).
      if (!/^\d+(\.\d+){0,3}$/.test(version)) {
        this.error(`package.json version "${version}" is not a valid Chrome extension version`);
      }
      const { manifest_version, name, ...rest } = JSON.parse(readFileSync(`${root}manifest.json`, "utf8"));
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify({ manifest_version, name, version, ...rest }, null, 2) + "\n",
      });
    },
  };
}

export default defineConfig({
  root,
  base: "./",
  plugins: [react(), manifest()],
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
