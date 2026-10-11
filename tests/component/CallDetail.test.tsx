import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { loadDescriptorSet, SchemaIndex } from "../../extension/src/core/schema";
import { CallDetail } from "../../extension/src/panel/CallDetail";
import { decodeRow } from "../../extension/src/panel/useDecodedRows";
import { demoCalls, syntheticCalls } from "../fixtures/builders";
import { descriptorUrl } from "../support/renderPanel";
import { loadDescriptor } from "../support/fakeSchemaBackend";

const schemas = SchemaIndex.of(loadDescriptorSet(new Uint8Array(await loadDescriptor(descriptorUrl))));
const [, connectJson, grpcWebGreet, fail, connectCount] = demoCalls;

function renderDetail(raw: (typeof demoCalls)[number], index = schemas) {
  const onOpenSchemas = vi.fn();
  const onClose = vi.fn();
  return { onOpenSchemas, onClose, render: render(<CallDetail row={decodeRow(raw, index)} onClose={onClose} onOpenSchemas={onOpenSchemas} />) };
}
const tab = (name: string) => page.getByRole("button", { name, exact: true });

describe("CallDetail", () => {
  it("opens on the Response tab with the typed message", async () => {
    await renderDetail(grpcWebGreet).render;
    await expect.element(page.getByText("demo.v1.GreetResponse")).toBeVisible();
    await expect.element(page.getByText('"MOOD_HAPPY"')).toBeVisible();
    await expect.element(page.getByText("schema", { exact: true })).toBeVisible();
  });

  it("switches between tabs", async () => {
    await renderDetail(grpcWebGreet).render;

    await tab("Request").click();
    await expect.element(page.getByText('"9007199254740993"')).toBeVisible();

    await tab("Headers").click();
    await expect.element(page.getByText("/demo.v1.DemoService/Greet")).toBeVisible();
    await expect.element(page.getByText("grpc-web / proto")).toBeVisible();

    await tab("Trailers").click();
    await expect.element(page.getByText("grpc-status", { exact: true })).toBeVisible();
  });

  it("shows the error status above an empty response", async () => {
    await renderDetail(fail).render;
    await expect.element(page.getByText("7 PERMISSION_DENIED")).toBeVisible();
    await expect.element(page.getByText("— no greeting for ytjmt")).toBeVisible();
    await expect.element(page.getByText("No messages")).toBeVisible();
  });

  it("numbers stream messages", async () => {
    await renderDetail(connectCount).render;
    for (let i = 1; i <= 5; i++) await expect.element(page.getByText(`#${i}`, { exact: true })).toBeVisible();
  });

  it("labels JSON-codec messages", async () => {
    await renderDetail(connectJson).render;
    await expect.element(page.getByText("json", { exact: true })).toBeVisible();
  });

  it("offers schema registration when the schema is missing", async () => {
    const { onOpenSchemas, render: r } = renderDetail(grpcWebGreet, SchemaIndex.empty);
    await r;
    await expect.element(page.getByRole("note")).toMatchTextContent("No schema is registered for demo.v1.DemoService");
    await expect.element(page.getByText("schemaless")).toBeVisible();
    await page.getByRole("link", { name: "Register a schema" }).click();
    expect(onOpenSchemas).toHaveBeenCalledOnce();
  });

  it("renders decoder warnings and per-message errors", async () => {
    await renderDetail(syntheticCalls.truncatedResponse()).render;
    await expect.element(page.getByRole("note")).toMatchTextContent("10 trailing bytes of an incomplete frame in the response");

    await renderDetail(syntheticCalls.compressedFrame()).render;
    await tab("Request").last().click();
    await expect.element(page.getByRole("note").last()).toMatchTextContent("Marked as compressed, but no header says which encoding was used");
  });

  it("copies a message as JSON", async () => {
    const execCommand = vi.spyOn(document, "execCommand");
    await renderDetail(grpcWebGreet).render;
    await page.getByRole("button", { name: "Copy JSON" }).click();
    expect(execCommand).toHaveBeenCalledWith("copy");
    await expect.element(page.getByRole("button", { name: "Copied" })).toBeVisible();
  });

  it("closes", async () => {
    const { onClose, render: r } = renderDetail(grpcWebGreet);
    await r;
    await page.getByRole("button", { name: "Close" }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
