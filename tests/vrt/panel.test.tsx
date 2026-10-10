import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import type { SchemaSource } from "../../extension/src/core/storage";
import type { RawCall } from "../../extension/src/core/types";
import { demoCalls, shopCalls, syntheticCalls } from "../fixtures/builders";
import { loadDescriptor } from "../support/fakeSchemaBackend";
import { demoSchemaSource, descriptorUrl, renderPanel } from "../support/renderPanel";

type Theme = "light" | "dark";

async function shot(
  name: string,
  options: {
    theme: Theme;
    calls?: RawCall[];
    withSchema?: boolean;
    /** Replaces the default single unscoped demo schema. */
    sources?: SchemaSource[];
    /** Descriptors served to URL schemas when they refresh on open. */
    urls?: Record<string, ArrayBuffer>;
    size?: { width: number; height: number };
    /** Interactions after render, e.g. selecting a row. */
    act?: () => Promise<void>;
  },
) {
  const { container } = await renderPanel({
    calls: options.calls ?? demoCalls,
    sources: options.sources ?? (options.withSchema === false ? [] : [await demoSchemaSource()]),
    urls: options.urls,
    theme: options.theme,
    size: options.size ?? { width: 900, height: 420 },
  });
  // Wait for the schema to load so rows are decoded with it.
  const schemaCount = options.sources?.length ?? (options.withSchema === false ? 0 : 1);
  await expect.element(page.getByRole("button", { name: `Schemas (${schemaCount})` })).toBeVisible();
  await options.act?.();
  await expect(page.elementLocator(container)).toMatchScreenshot(`${name}-${options.theme}`);
}

const selectRow = (method: string, transport?: string) => async () => {
  const selector = `.list tbody tr[data-method="${method}"]${transport ? `[data-transport="${transport}"]` : ""}`;
  await page.elementLocator(document.querySelector(selector)!).click();
};
const openTab = (name: string) => page.getByRole("button", { name, exact: true }).click();
const openManage = async (n: number) => {
  await page.getByRole("button", { name: `Schemas (${n})` }).click();
  await page.getByRole("tab", { name: "Manage" }).click();
};
const openBrowse = (n: number) => page.getByRole("button", { name: `Schemas (${n})` }).click();
const openTree = (name: string) => page.getByRole("treeitem", { name, exact: true }).click();

describe.each<Theme>(["light", "dark"])("%s theme", (theme) => {
  test("call list", () => shot("list", { theme }));

  test("response with Any and Timestamp", () =>
    shot("detail-response", { theme, calls: [syntheticCalls.withAny()], act: selectRow("Greet") }));

  test("error status", () => shot("detail-error", { theme, act: selectRow("Fail") }));

  test("schema browser: service", () => shot("browse-service", { theme, act: () => openBrowse(1) }));

  test("schema browser: message", () =>
    shot("browse-message", {
      theme,
      size: { width: 900, height: 520 },
      act: async () => {
        await openBrowse(1);
        await openTree("GreetRequest");
      },
    }));

  test("call detail with copy menu", () =>
    shot("detail-copy-menu", {
      theme,
      act: async () => {
        await selectRow("Greet", "grpc-web")();
        await page.getByRole("button", { name: "Copy as…" }).click();
      },
    }));

  test("schemas view", () =>
    shot("schemas", {
      theme,
      act: () => openManage(1),
    }));
});

describe("light theme details", () => {
  const theme = "light";

  test("request tab", () =>
    shot("detail-request", {
      theme,
      act: async () => {
        await selectRow("Greet", "grpc-web")();
        await openTab("Request");
      },
    }));

  test("headers tab", () =>
    shot("detail-headers", {
      theme,
      size: { width: 900, height: 640 },
      act: async () => {
        await selectRow("Greet", "grpc-web")();
        await openTab("Headers");
      },
    }));

  test("trailers tab", () =>
    shot("detail-trailers", {
      theme,
      act: async () => {
        await selectRow("Greet", "grpc-web")();
        await openTab("Trailers");
      },
    }));

  test("server stream", () =>
    shot("detail-stream", { theme, size: { width: 900, height: 640 }, act: selectRow("Count", "connect-stream") }));

  test("schemaless with warning", () =>
    shot("detail-schemaless", { theme, withSchema: false, act: selectRow("Greet", "grpc-web") }));

  test("decoder warnings", () =>
    shot("detail-warnings", { theme, calls: [syntheticCalls.truncatedResponse()], act: selectRow("Greet") }));

  test("narrow pane", () =>
    shot("detail-narrow", { theme, size: { width: 420, height: 420 }, act: selectRow("Greet", "grpc-web") }));

  test("empty state", () => shot("empty", { theme, calls: [] }));

  test("schema browser: medium-width pane", () =>
    shot("browse-service-medium", { theme, size: { width: 760, height: 420 }, act: () => openBrowse(1) }));

  test("schema browser: enum and usages", () =>
    shot("browse-enum", {
      theme,
      act: async () => {
        await openBrowse(1);
        await openTree("Mood");
      },
    }));

  test("schema browser: search", () =>
    shot("browse-search", {
      theme,
      act: async () => {
        await openBrowse(1);
        await page.getByRole("searchbox").fill("name");
      },
    }));

  test("schema browser: narrow pane", () =>
    shot("browse-narrow", {
      theme,
      size: { width: 420, height: 640 },
      act: async () => {
        await openBrowse(1);
        await openTree("GreetResponse");
      },
    }));

  test("calls filtered by method from the browser", () =>
    shot("list-method-filter", {
      theme,
      act: async () => {
        await openBrowse(1);
        await page.getByRole("link", { name: /^3 calls/ }).click();
      },
    }));

  test("shop: nested product response", () =>
    shot("shop-product", {
      theme,
      calls: shopCalls,
      size: { width: 900, height: 640 },
      act: selectRow("GetProduct", "grpc-web"),
    }));

  test("shop: gRPC-Web error details", () =>
    shot("shop-error-details", { theme, calls: shopCalls, act: selectRow("CreateOrder", "grpc-web") }));

  test("shop: Product message in the browser", () =>
    shot("shop-browse-product", {
      theme,
      calls: shopCalls,
      size: { width: 900, height: 760 },
      act: async () => {
        await openBrowse(1);
        await openTree("Product");
      },
    }));

  test("shop: all four method kinds", () =>
    shot("shop-browse-orders", {
      theme,
      calls: shopCalls,
      size: { width: 900, height: 520 },
      act: async () => {
        await openBrowse(1);
        await openTree("OrderService");
      },
    }));

  test("shop: enum with alias and deprecated value", () =>
    shot("shop-browse-enum-alias", {
      theme,
      calls: shopCalls,
      act: async () => {
        await openBrowse(1);
        await openTree("ProductStatus");
      },
    }));

  test("unknown fields warning", () =>
    shot("detail-unknown-fields", { theme, calls: [syntheticCalls.unknownFields()], act: selectRow("Greet") }));

  test("schemas scoped per environment", async () => {
    const stgUrl = "https://stg.example.com/_devtools/descriptor.binpb";
    return shot("schemas-scoped", {
      theme,
      sources: [
        await demoSchemaSource({ id: "a", name: "local.binpb", scopes: ["http://localhost:8080/*"] }),
        await demoSchemaSource({
          id: "b",
          name: stgUrl,
          kind: "url",
          url: stgUrl,
          scopes: ["https://*.stg.example.com/*", "https://stg.example.com/*"],
        }),
      ],
      urls: { [stgUrl]: await loadDescriptor(descriptorUrl) },
      act: () => openManage(2),
    });
  });

  test("schemas defining the same service for the same requests", async () =>
    shot("schemas-duplicate", {
      theme,
      sources: [
        await demoSchemaSource({ id: "a", name: "api-v1.binpb" }),
        await demoSchemaSource({ id: "b", name: "api-v1-old.binpb" }),
      ],
      act: () => openManage(2),
    }));

  test("scope editor", () =>
    shot("schemas-scope-editor", {
      theme,
      act: async () => {
        await openManage(1);
        await page.getByRole("button", { name: "Edit" }).click();
        await page.getByLabelText("Applies to").fill("http://localhost:8080/*\nhttps://*.stg.example.com/*");
      },
    }));

  test("schema out of scope", async () =>
    shot("detail-out-of-scope", {
      theme,
      sources: [await demoSchemaSource({ name: "stg.binpb", scopes: ["https://*.stg.example.com/*"] })],
      act: selectRow("Greet", "grpc-web"),
    }));
});
