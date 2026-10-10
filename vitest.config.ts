import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const browser = (viewport: { width: number; height: number }) => ({
  enabled: true,
  provider: playwright(),
  headless: true,
  instances: [{ browser: "chromium" as const }],
  viewport,
});

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: {
          name: "component",
          include: ["tests/component/**/*.test.tsx"],
          setupFiles: ["tests/support/browser-setup.ts"],
          browser: browser({ width: 1000, height: 700 }),
        },
      },
      {
        // Run via `pnpm test:vrt`, which starts the browser container first.
        extends: true,
        test: {
          name: "vrt",
          include: ["tests/vrt/**/*.test.tsx"],
          setupFiles: ["tests/support/browser-setup.ts", "tests/support/vrt-setup.ts"],
          browser: {
            ...browser({ width: 1000, height: 700 }),
            // Chromium runs in the Playwright container (compose.yaml); `<loopback>`
            // lets it reach the Vitest server on this host as localhost.
            provider: playwright({
              connectOptions: { wsEndpoint: "ws://127.0.0.1:3000/", exposeNetwork: "<loopback>" },
            }),
            expect: {
              toMatchScreenshot: {
                // Rendering is always Linux, whatever the host OS.
                resolveScreenshotPath: ({ root, testFileDirectory, screenshotDirectory, testFileName, arg, browserName, ext }) =>
                  join(root, testFileDirectory, screenshotDirectory, testFileName, `${arg}-${browserName}-linux${ext}`),
                comparatorName: "pixelmatch",
                // Rendering in Docker is deterministic; any changed pixel beyond anti-aliasing noise fails.
                comparatorOptions: { threshold: 0.1, allowedMismatchedPixels: 0 },
              },
            },
          },
        },
      },
    ],
  },
});
