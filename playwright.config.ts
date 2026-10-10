import { defineConfig } from "@playwright/test";

export const DEMO_PORT = 8090;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "tests/e2e/.results",
  // Each test launches its own Chrome with DevTools open; keep it predictable.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  webServer: {
    command: "pnpm example:build && tsx example/server/server.ts",
    url: `http://localhost:${DEMO_PORT}/`,
    env: { PORT: String(DEMO_PORT) },
    reuseExistingServer: true,
  },
});
