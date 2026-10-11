import type { Frame, Page } from "@playwright/test";
import { DEMO_ORIGIN, expect, test } from "./fixtures";

const DESCRIPTOR = new URL("../../example/descriptor.binpb", import.meta.url).pathname;

/** Runs every demo RPC once (see example/client/main.ts). */
async function runDemo(app: Page) {
  await app.goto(`${DEMO_ORIGIN}/?auto=1`);
  await expect(app).toHaveTitle("done", { timeout: 30_000 });
}

const row = (panel: Frame, method: string, transport?: string) =>
  panel.locator(`.list tbody tr[data-method="${method}"]${transport ? `[data-transport="${transport}"]` : ""}`);
const tab = (panel: Frame, name: string) => panel.locator(".tabs").getByRole("button", { name, exact: true });
const detail = (panel: Frame) => panel.locator(".detail .tab-body");

async function uploadSchema(panel: Frame) {
  await panel.getByRole("button", { name: /^Schemas/ }).click();
  await panel.locator('.dropzone input[type="file"]').setInputFiles(DESCRIPTOR);
  await expect(panel.locator(".schema")).toContainText("demo.v1.DemoService");
  await panel.getByRole("button", { name: "Schemas (1)" }).click();
}

test("records RPCs and keeps binary request bodies byte-exact", async ({ app, devtools }) => {
  await runDemo(app);
  const calls = await devtools
    .devtoolsPage()
    .evaluate(() => window.__grpcDevtoolsStore!.calls.map((c) => ({ url: c.url, body: c.requestBodyText })));
  expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
    "/demo.v1.DemoService/Greet",
    "/demo.v1.DemoService/Greet",
    "/demo.v1.DemoService/Greet",
    "/demo.v1.DemoService/Fail",
    "/demo.v1.DemoService/Count",
    "/demo.v1.DemoService/Count",
  ]);
  // The demo sends blob = [00 ff fe 80 c3 28 7f]; HAR keeps it as Latin-1.
  const binary = calls.find((c) => c.body?.startsWith("\u0000"))!.body!;
  expect([...binary].every((ch) => ch.charCodeAt(0) <= 0xff)).toBe(true);
  expect(binary).toContain("\u0000ÿþ\u0080Ã(\u007f");
});

test("shows messages by field number when no schema is registered", async ({ app, devtools }) => {
  await runDemo(app);
  const panel = await devtools.openPanel();

  await expect(panel.locator(".list tbody tr")).toHaveCount(6);
  await expect(row(panel, "Greet", "grpc-web")).toContainText("no schema");

  await row(panel, "Greet", "grpc-web").click();
  await expect(detail(panel)).toContainText("No schema is registered for demo.v1.DemoService");
  await expect(panel.locator(".message .badge")).toHaveText("schemaless");
  await expect(detail(panel)).toContainText('1: "Hello, ytjmt! (7 bytes received)"');
});

test("decodes every protocol with an uploaded schema", async ({ app, devtools }, testInfo) => {
  await runDemo(app);
  const panel = await devtools.openPanel();
  // Uploading after capture also checks that recorded calls are re-decoded.
  await uploadSchema(panel);
  await expect(panel.locator(".badge.warn")).toHaveCount(0);

  await test.step("grpc-web unary response, including Any", async () => {
    await row(panel, "Greet", "grpc-web").click();
    await expect(panel.locator(".message-header .type")).toHaveText("demo.v1.GreetResponse");
    await expect(detail(panel)).toContainText('mood: "MOOD_HAPPY"');
    await expect(detail(panel)).toContainText('@type: "type.googleapis.com/demo.v1.Note"');
    await testInfo.attach("grpc-web-response", { body: await devtools.window.screenshot(), contentType: "image/png" });
  });

  await test.step("request with int64 and non-UTF-8 bytes", async () => {
    await tab(panel, "Request").click();
    await expect(detail(panel)).toContainText('bigNumber: "9007199254740993"');
    await expect(detail(panel)).toContainText('blob: "AP/+gMMofw=="');
  });

  await test.step("error status", async () => {
    await row(panel, "Fail").click();
    await tab(panel, "Response").click();
    await expect(panel.locator(".status-box.failed")).toContainText("7 PERMISSION_DENIED — no greeting for ytjmt");
  });

  await test.step("server streams over Connect and gRPC-Web", async () => {
    for (const transport of ["connect-stream", "grpc-web"]) {
      await row(panel, "Count", transport).click();
      await expect(panel.locator(".message")).toHaveCount(5);
      await expect(panel.locator(".message-header .type").first()).toHaveText("demo.v1.CountResponse");
    }
  });

  await test.step("message type opens in the schema browser", async () => {
    await row(panel, "Greet", "grpc-web").click();
    await tab(panel, "Response").click();
    await panel.getByRole("link", { name: "demo.v1.GreetResponse" }).click();
    await expect(panel.getByRole("heading", { name: "demo.v1.GreetResponse" })).toBeVisible();
    await expect(panel.locator(".type-detail")).toContainText("Response for DemoService.Greet.");
    await panel.getByRole("button", { name: "Schemas (1)" }).click();
  });

  await test.step("copy as buf curl", async () => {
    await row(panel, "Greet", "grpc-web").click();
    await panel.getByRole("button", { name: "Copy as…" }).click();
    await panel.getByRole("menuitem", { name: "Copy as buf curl" }).click();
    await expect(panel.getByRole("button", { name: "Copied" })).toBeVisible();
  });

  await test.step("Connect unary with JSON codec", async () => {
    await row(panel, "Greet", "connect").and(panel.locator('[data-codec="json"]')).click();
    await expect(panel.locator(".message .badge")).toHaveText("json");
    await expect(detail(panel)).toContainText('mood: "MOOD_HAPPY"');
  });
});

test("disabling a schema falls back to schemaless", async ({ app, devtools }) => {
  await runDemo(app);
  const panel = await devtools.openPanel();
  await uploadSchema(panel);

  await panel.getByRole("button", { name: "Schemas (1)" }).click();
  await panel.getByRole("tab", { name: "Manage" }).click();
  // The checkbox reflects IndexedDB state, so it flips after the async write.
  const enabled = panel.locator(".schema-header input[type=checkbox]");
  await enabled.click();
  await expect(enabled).not.toBeChecked();
  await panel.getByRole("button", { name: "Schemas (0)" }).click();

  await row(panel, "Greet", "grpc-web").click();
  await expect(panel.locator(".message .badge")).toHaveText("schemaless");
});

test("clears on navigation unless Preserve log is checked", async ({ app, devtools }) => {
  await runDemo(app);
  const panel = await devtools.openPanel();
  const rows = panel.locator(".list tbody tr");
  await expect(rows).toHaveCount(6);

  await app.goto(`${DEMO_ORIGIN}/`);
  await expect(rows).toHaveCount(0);

  await panel.getByLabel("Preserve log").check();
  await runDemo(app);
  await app.goto(`${DEMO_ORIGIN}/`);
  await expect(rows).toHaveCount(6);
  await expect(panel.locator(".statusbar")).toHaveText("6 / 6 requests");
});

test("decodes the shop scenario with a realistic multi-file schema", async ({ app, devtools }) => {
  await app.goto(`${DEMO_ORIGIN}/?auto=shop`);
  await expect(app).toHaveTitle("done", { timeout: 30_000 });
  const panel = await devtools.openPanel();
  await uploadSchema(panel);

  await expect(panel.locator(".list tbody tr")).toHaveCount(12);
  await expect(panel.locator(".badge.warn")).toHaveCount(0);

  await test.step("nested messages, maps and Struct", async () => {
    await row(panel, "GetProduct", "grpc-web").first().click();
    await expect(detail(panel)).toContainText('title: "Organic Cotton Tee"');
    await expect(detail(panel)).toContainText('season: "SS26"');
  });

  await test.step("gRPC-Web error details from grpc-status-details-bin", async () => {
    await row(panel, "CreateOrder", "grpc-web").click();
    await expect(panel.locator(".status-box.failed")).toContainText("9 FAILED_PRECONDITION");
    await expect(panel.locator(".status-box.failed")).toContainText('type: "shop.v1.OutOfStock"');
    await expect(panel.locator(".status-box.failed")).toContainText('sku: "TEE-001-WHT-L"');
  });

  await test.step("all four method kinds in the schema browser", async () => {
    await panel.getByRole("button", { name: "Schemas (1)" }).click();
    await panel.getByRole("treeitem", { name: "OrderService", exact: true }).click();
    await expect(panel.locator(".method-list")).toContainText("client streaming");
    await expect(panel.locator(".method-list")).toContainText("bidi streaming");
  });
});

test("decompresses gzip and brotli RPC messages", async ({ app, devtools }) => {
  await app.goto(`${DEMO_ORIGIN}/?auto=compression`);
  await expect(app).toHaveTitle("done", { timeout: 30_000 });
  const panel = await devtools.openPanel();
  await uploadSchema(panel);

  const rows = panel.locator(".list tbody tr");
  await expect(rows).toHaveCount(5);
  // gzip: gRPC-Web, Connect streaming, Connect unary request, Connect GET.
  for (let i = 0; i < 4; i++) {
    await rows.nth(i).click();
    for (const name of ["Request", "Response"]) {
      await tab(panel, name).click();
      await expect(panel.locator(".message .badge").first()).toHaveText("schema");
      await expect(detail(panel)).not.toContainText("could not be decompressed");
    }
  }
  await expect(detail(panel)).toContainText('title: "Organic Cotton Tee"');

  // Chrome's DecompressionStream has no brotli (as of Chrome 156): say so instead of guessing.
  await rows.nth(4).click();
  await tab(panel, "Response").click();
  await expect(detail(panel)).toContainText("Compressed with br, which could not be decompressed");
  await expect(panel.locator(".status-box.failed")).toContainText("Trailers are compressed with br");
});
