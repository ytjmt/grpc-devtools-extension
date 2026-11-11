import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import packageJson from "../../package.json" with { type: "json" };

describe("tooling", () => {
  it("runs the VRT browser container with the installed Playwright version", () => {
    // The remote browser server must match the client, or connecting fails. compose.yaml
    // takes the version from test:vrt, which reads it from the installed @playwright/test.
    const compose = readFileSync(new URL("../../compose.yaml", import.meta.url), "utf8");
    const versions = [...compose.matchAll(/playwright(?::v|@)([^\s-]+)/g)].map((m) => m[1]);
    expect(versions).toEqual(["${PLAYWRIGHT_VERSION}", "${PLAYWRIGHT_VERSION}"]);
    expect(packageJson.scripts["test:vrt"]).toContain(
      "PLAYWRIGHT_VERSION=$(node -p \"require('@playwright/test/package.json').version\")",
    );
  });

  it("pins the same pnpm in mise.toml and package.json", () => {
    const mise = readFileSync(new URL("../../mise.toml", import.meta.url), "utf8");
    const pinned = /^pnpm = "([^"]+)"$/m.exec(mise)?.[1];
    expect(pinned).toBeDefined();
    expect(packageJson.packageManager).toBe(`pnpm@${pinned}`);
    expect(packageJson.devEngines.packageManager.version).toBe(pinned);
  });
});
