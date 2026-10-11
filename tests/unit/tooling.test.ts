import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import playwrightPackage from "@playwright/test/package.json" with { type: "json" };

describe("tooling", () => {
  it("runs the VRT browser container with the installed Playwright version", () => {
    // The remote browser server must match the client, or connecting fails.
    const compose = readFileSync(new URL("../../compose.yaml", import.meta.url), "utf8");
    const versions = [...compose.matchAll(/playwright(?::v|@)(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    expect(versions).toEqual([playwrightPackage.version, playwrightPackage.version]);
  });
});
