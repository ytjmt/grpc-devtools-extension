import { defineConfig } from "vite-plus";

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  build: { outDir: "dist", emptyOutDir: true },
});
