import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { compressionCalls, demoCalls, syntheticCalls } from "../fixtures/builders";
import { loadDescriptor } from "../support/fakeSchemaBackend";
import { demoSchemaSource, descriptorUrl, renderPanel } from "../support/renderPanel";

const rowCount = () => document.querySelectorAll(".list tbody tr").length;
const schemasButton = (n: number) => page.getByRole("button", { name: `Schemas (${n})` });
/** "Schemas (n)" opens Browse when schemas exist; management lives under the Manage tab. */
async function openManage(n: number) {
  await schemasButton(n).click();
  if (n > 0) await page.getByRole("tab", { name: "Manage" }).click();
}

describe("Panel", () => {
  it("filters by method and by errors", async () => {
    await renderPanel({ calls: demoCalls });
    await expect.poll(rowCount).toBe(6);

    await page.getByRole("textbox", { name: "Filter (method)" }).fill("count");
    await expect.poll(rowCount).toBe(2);
    await expect.element(page.getByText("2 / 6 requests")).toBeVisible();

    await page.getByRole("textbox", { name: "Filter (method)" }).fill("");
    await page.getByLabelText("Errors only").click();
    await expect.poll(rowCount).toBe(1);
  });

  it("clears the log and toggles Preserve log on the store", async () => {
    const { store } = await renderPanel({ calls: demoCalls });
    await page.getByLabelText("Preserve log").click();
    expect(store.preserveLog).toBe(true);

    await page.getByRole("button", { name: "Clear" }).click();
    await expect.element(page.getByText("Waiting for gRPC / gRPC-Web / Connect requests…")).toBeVisible();
    expect(store.calls).toHaveLength(0);
  });

  it("shows new calls as they arrive", async () => {
    const { store } = await renderPanel();
    const { id: _id, ...call } = demoCalls[0];
    store.add(call);
    await expect.poll(rowCount).toBe(1);
  });

  it("re-decodes recorded calls after a schema file is uploaded", async () => {
    const { sources } = await renderPanel({ calls: demoCalls });
    await expect.element(page.getByText("no schema").first()).toBeVisible();

    await schemasButton(0).click();
    await expect.element(page.getByText("No schemas registered")).toBeVisible();
    const file = new File([await loadDescriptor(descriptorUrl)], "descriptor.binpb");
    await userEvent.upload(page.getByTestId("schema-file-input"), file);
    await expect.element(page.getByText("demo.v1.DemoService")).toBeVisible();
    expect([...sources.values()].map((s) => s.name)).toEqual(["descriptor.binpb"]);

    await schemasButton(1).click();
    expect(document.querySelectorAll(".badge.warn")).toHaveLength(0);
  });

  it("rejects files that are not descriptor sets", async () => {
    const { sources } = await renderPanel();
    await schemasButton(0).click();
    await userEvent.upload(page.getByTestId("schema-file-input"), new File([new Uint8Array()], "empty.bin"));
    await expect.element(page.getByRole("alert")).toMatchTextContent("The FileDescriptorSet contains no files");
    expect(sources.size).toBe(0);
  });

  it("adds a schema from a URL", async () => {
    const url = "http://localhost:8080/_devtools/descriptor.binpb";
    await renderPanel({ urls: { [url]: await loadDescriptor(descriptorUrl) } });
    await schemasButton(0).click();
    await page.getByRole("textbox").last().fill(url);
    await page.getByRole("button", { name: "Add from URL" }).click();
    await expect.element(page.getByText(url, { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect.element(schemasButton(1)).toBeVisible();
  });

  it("reports a denied host permission", async () => {
    await renderPanel({ grantPermission: false });
    await schemasButton(0).click();
    await page.getByRole("textbox").last().fill("http://example.test/descriptor.binpb");
    await page.getByRole("button", { name: "Add from URL" }).click();
    await expect.element(page.getByRole("alert")).toMatchTextContent("Access to http://example.test was not granted");
  });

  it("disables and deletes schemas", async () => {
    const { sources } = await renderPanel({ calls: demoCalls, sources: [await demoSchemaSource()] });
    await expect.element(schemasButton(1)).toBeVisible();

    await openManage(1);
    await page.getByRole("checkbox").last().click();
    await expect.element(schemasButton(0)).toBeVisible();
    expect(sources.get("demo")?.enabled).toBe(false);

    await page.getByRole("button", { name: "Delete" }).click();
    await expect.element(page.getByText("No schemas registered")).toBeVisible();
    expect(sources.size).toBe(0);
  });
});

describe("Panel errors", () => {
  it("can dismiss a schema error", async () => {
    await renderPanel({ grantPermission: false });
    await page.getByRole("button", { name: "Schemas (0)" }).click();
    await page.getByRole("textbox").last().fill("http://example.test/descriptor.binpb");
    await page.getByRole("button", { name: "Add from URL" }).click();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  });
});

describe("schema scopes", () => {
  const scopesText = () => (document.querySelector(".scopes") as HTMLElement).innerText;

  it("defaults URL schemas to the descriptor's origin", async () => {
    const url = "http://localhost:8080/_devtools/descriptor.binpb";
    const { sources } = await renderPanel({ urls: { [url]: await loadDescriptor(descriptorUrl) } });
    await page.getByRole("button", { name: "Schemas (0)" }).click();
    await page.getByRole("textbox").last().fill(url);
    await page.getByRole("button", { name: "Add from URL" }).click();
    await expect.element(page.getByText("http://localhost:8080/*", { exact: true })).toBeVisible();
    expect([...sources.values()][0].scopes).toEqual(["http://localhost:8080/*"]);
  });

  it("edits scopes and keeps the editor open on invalid input", async () => {
    const { sources } = await renderPanel({ sources: [await demoSchemaSource()] });
    await openManage(1);
    expect(scopesText()).toContain("All requests");

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabelText("Applies to").fill("localhost:8080");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.element(page.getByRole("alert")).toMatchTextContent("Invalid URL pattern: localhost:8080");
    await expect.element(page.getByLabelText("Applies to")).toBeVisible();

    await page.getByLabelText("Applies to").fill("http://localhost:8080\nhttps://*.stg.example.com/*");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.element(page.getByText("https://*.stg.example.com/*", { exact: true })).toBeVisible();
    expect(sources.get("demo")?.scopes).toEqual(["http://localhost:8080/*", "https://*.stg.example.com/*"]);
  });

  it("explains when a schema exists but its scope excludes the request", async () => {
    await renderPanel({
      calls: demoCalls,
      sources: [await demoSchemaSource({ name: "stg.binpb", scopes: ["https://*.stg.example.com/*"] })],
    });
    await expect.element(page.getByRole("button", { name: "Schemas (1)" })).toBeVisible();
    await page.elementLocator(document.querySelector('tr[data-method="Greet"][data-transport="grpc-web"]')!).click();
    await expect
      .element(page.getByRole("note"))
      .toMatchTextContent("demo.v1.DemoService is defined in stg.binpb, but its scope does not include this request URL.");
    await page.getByRole("link", { name: "Edit scopes" }).click();
    await expect.element(page.getByText("https://*.stg.example.com/*", { exact: true })).toBeVisible();
  });

  it("uses a scoped schema over an unscoped fallback without warnings", async () => {
    await renderPanel({
      calls: demoCalls,
      sources: [
        await demoSchemaSource({ id: "a", name: "a-global.binpb" }),
        await demoSchemaSource({ id: "b", name: "b-local.binpb", scopes: ["http://localhost:8080/*"] }),
      ],
    });
    await expect.element(page.getByRole("button", { name: "Schemas (2)" })).toBeVisible();
    await page.elementLocator(document.querySelector('tr[data-method="Greet"][data-transport="grpc-web"]')!).click();
    await page.getByRole("button", { name: "Headers", exact: true }).click();
    await expect.element(page.getByText("b-local.binpb", { exact: true })).toBeVisible();
    expect(document.querySelectorAll('[role="note"]')).toHaveLength(0);

    await openManage(2);
    expect(document.querySelectorAll('[role="note"]')).toHaveLength(0);
  });

  it("warns when two schemas define a service for the same requests", async () => {
    await renderPanel({
      calls: demoCalls,
      sources: [
        await demoSchemaSource({ id: "a", name: "a.binpb" }),
        await demoSchemaSource({ id: "b", name: "b.binpb" }),
      ],
    });
    await expect.element(page.getByRole("button", { name: "Schemas (2)" })).toBeVisible();
    await page.elementLocator(document.querySelector('tr[data-method="Greet"][data-transport="grpc-web"]')!).click();
    await expect
      .element(page.getByRole("note"))
      .toMatchTextContent("demo.v1.DemoService is also defined in b.binpb; decoded with a.binpb");

    await openManage(2);
    await expect
      .element(page.getByRole("note").first())
      .toMatchTextContent(
        "b.binpb also defines demo.v1.DemoService, shop.v1.CatalogService, shop.v1.OrderService for the same requests",
      );
  });
});

describe("calls and schemas together", () => {
  const selectGrpcWebGreet = () =>
    page.elementLocator(document.querySelector('tr[data-method="Greet"][data-transport="grpc-web"]')!).click();

  it("opens a message type from the call detail in the browser", async () => {
    await renderPanel({ calls: demoCalls, sources: [await demoSchemaSource()] });
    await expect.element(schemasButton(1)).toBeVisible();
    await selectGrpcWebGreet();
    await page.getByRole("link", { name: "demo.v1.GreetResponse" }).click();
    await expect.element(page.getByRole("tab", { name: "Browse" })).toHaveAttribute("aria-selected", "true");
    await expect.element(page.getByRole("heading", { name: "demo.v1.GreetResponse" })).toBeVisible();
  });

  it("describes JSON keys with their schema field", async () => {
    await renderPanel({ calls: demoCalls, sources: [await demoSchemaSource()] });
    await expect.element(schemasButton(1)).toBeVisible();
    await selectGrpcWebGreet();
    await page.getByRole("button", { name: "Request", exact: true }).click();
    const key = [...document.querySelectorAll(".jt-key")].find((k) => k.textContent === "bigNumber: ");
    expect(key?.getAttribute("title")).toBe("#2 big_number: int64\nAbove 2^53, to check that int64 stays exact in JSON.");
    const tags = [...document.querySelectorAll(".jt-key")].find((k) => k.textContent === "tags: ");
    expect(tags?.getAttribute("title")).toBe("#4 tags: repeated string");
  });

  it("warns when the response has fields the schema lacks", async () => {
    await renderPanel({ calls: [syntheticCalls.unknownFields()], sources: [await demoSchemaSource()] });
    await expect.element(schemasButton(1)).toBeVisible();
    await page.elementLocator(document.querySelector("tbody tr")!).click();
    await expect
      .element(page.getByRole("note"))
      .toMatchTextContent("Field numbers not defined in demo.v1.GreetResponse: #9. The registered schema may be older");
  });

  it("copies the call as buf curl or grpcurl", async () => {
    const execCommand = vi.spyOn(document, "execCommand");
    let copied = "";
    const original = HTMLTextAreaElement.prototype.select;
    HTMLTextAreaElement.prototype.select = function () {
      copied = this.value;
      original.call(this);
    };
    try {
      await renderPanel({ calls: demoCalls, sources: [await demoSchemaSource()] });
      await expect.element(schemasButton(1)).toBeVisible();
      await selectGrpcWebGreet();
      await page.getByRole("button", { name: "Copy as…" }).click();
      await page.getByRole("menuitem", { name: "Copy as buf curl" }).click();
      expect(execCommand).toHaveBeenCalledWith("copy");
      expect(copied).toMatch(/^buf curl \\\n {2}--schema 'descriptor\.binpb' \\\n {2}--protocol grpcweb/);
      await expect.element(page.getByRole("button", { name: "Copied" })).toBeVisible();

      await page.getByRole("button", { name: /Copy as…|Copied/ }).click();
      await page.getByRole("menuitem", { name: "Copy as grpcurl" }).click();
      expect(copied).toContain("demo.v1.DemoService/Greet");
    } finally {
      HTMLTextAreaElement.prototype.select = original;
    }
  });

  it("disables copy commands when the request has no schema", async () => {
    await renderPanel({ calls: demoCalls });
    await selectGrpcWebGreet();
    await page.getByRole("button", { name: "Copy as…" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Copy as buf curl" })).toBeDisabled();
    await expect.element(page.getByRole("menuitem", { name: "Copy as grpcurl" })).toBeDisabled();
  });
});

describe("recorded calls in the schema browser", () => {
  const rowCount = () => document.querySelectorAll(".list tbody tr").length;

  it("shows counts per method and filters the log by one", async () => {
    await renderPanel({ calls: demoCalls, sources: [await demoSchemaSource()] });
    await schemasButton(1).click();
    const table = () => (document.querySelector(".type-detail .method-list") as HTMLElement).innerText;
    await expect.poll(table).toContain("3 calls · last 0 OK");
    expect(table()).toContain("1 call · last 7 PERMISSION_DENIED");
    expect(table()).toContain("2 calls · last 0 OK");
    expect(document.querySelector('[role="treeitem"][aria-label="Fail"] .tree-count.failed')?.textContent).toBe("1");

    await page.getByRole("link", { name: /^3 calls/ }).click();
    await expect.element(page.getByRole("status")).toMatchTextContent("Method: /demo.v1.DemoService/Greet");
    await expect.poll(rowCount).toBe(3);
    await expect.element(page.getByText("3 / 6 requests")).toBeVisible();

    await page.getByRole("button", { name: "Clear method filter" }).click();
    await expect.poll(rowCount).toBe(6);
  });

  it("shows a dash for methods without recorded calls", async () => {
    await renderPanel({ calls: [demoCalls[3]], sources: [await demoSchemaSource()] });
    await schemasButton(1).click();
    const greet = () =>
      [...document.querySelectorAll(".method-item")].find((m) => m.querySelector(".method-name")?.textContent === "Greet");
    await expect.poll(() => greet()?.querySelector(".method-calls")?.textContent).toBe("no calls");
  });
});

describe("compressed calls", () => {
  it("decodes compressed calls once decompression finishes", async () => {
    await renderPanel({ calls: compressionCalls, sources: [await demoSchemaSource()] });
    await expect.element(schemasButton(1)).toBeVisible();
    // WatchInventory over Connect streaming with gzip envelopes.
    await page.elementLocator(document.querySelector('tr[data-method="WatchInventory"]')!).click();
    await expect.poll(() => document.querySelectorAll(".message").length).toBe(4);
    await expect.element(page.getByRole("note")).not.toBeInTheDocument();
    expect(document.querySelector(".message-header .type")?.textContent).toBe("shop.v1.WatchInventoryResponse");
  });
});
