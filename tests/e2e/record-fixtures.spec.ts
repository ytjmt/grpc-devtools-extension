import { writeFile } from "node:fs/promises";
import type { RawCall } from "../../extension/src/core/types";
import { DEMO_ORIGIN, expect, test } from "./fixtures";

/**
 * Records real HAR-derived calls from the demo app for unit / component / VRT tests.
 * Opt-in: `pnpm fixtures:record` (add `-g shop` to re-record one scenario only).
 * Volatile fields are normalized so diffs stay meaningful.
 */
for (const { scenario, query, file } of [
  { scenario: "demo", query: "auto=1", file: "demo-calls.json" },
  { scenario: "shop", query: "auto=shop", file: "shop-calls.json" },
]) {
  test(`record ${scenario} calls as fixtures`, async ({ app, devtools }) => {
    test.skip(!process.env.RECORD_FIXTURES, "set RECORD_FIXTURES=1 (pnpm fixtures:record)");
    await app.goto(`${DEMO_ORIGIN}/?${query}`);
    await expect(app).toHaveTitle("done", { timeout: 30_000 });

    const calls: RawCall[] = await devtools.devtoolsPage().evaluate(() => window.__grpcDevtoolsStore!.calls);
    const normalized = calls.map((c, i) => ({
      ...c,
      url: c.url.replace(DEMO_ORIGIN, "http://localhost:8080"),
      startedDateTime: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      time: Math.round(c.time),
      requestHeaders: c.requestHeaders.map(normalizeHeader),
      responseHeaders: c.responseHeaders.map(normalizeHeader),
    }));
    await writeFile(new URL(`../fixtures/${file}`, import.meta.url), JSON.stringify(normalized, null, 2) + "\n");
  });
}

function normalizeHeader(h: { name: string; value: string }) {
  if (/^date$/i.test(h.name)) return { name: h.name, value: "Thu, 01 Jan 2026 00:00:00 GMT" };
  if (/^(origin|referer|host)$/i.test(h.name)) return { name: h.name, value: h.value.replace(/localhost:\d+/, "localhost:8080") };
  if (/^user-agent$/i.test(h.name)) return { name: h.name, value: "Mozilla/5.0 (fixture)" };
  return h;
}
