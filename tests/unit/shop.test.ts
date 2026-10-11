import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { getComment } from "../../extension/src/core/comments";
import { decodeCall } from "../../extension/src/core/decode";
import { fieldAt, fieldLabel, fieldTypeName } from "../../extension/src/core/fields";
import { loadDescriptorSet, SchemaIndex } from "../../extension/src/core/schema";
import { buildTree, buildUsages } from "../../extension/src/core/schemaTree";
import type { DecodedMessage } from "../../extension/src/core/types";
import { shopCalls } from "../fixtures/builders";

// A realistic multi-file schema: common.v1 shared types used by shop.v1 services.
const loaded = loadDescriptorSet(readFileSync(new URL("../../example/descriptor.binpb", import.meta.url)));
const schemas = SchemaIndex.of(loaded);
const decoded = shopCalls.map((c) => decodeCall(c, schemas));
const [, getTee, getMugMasked, update, del, notFound, watch, create, invalid, outOfStock, getOrder, track] = decoded;
const response = (i = 0) => (m: { responseMessages: DecodedMessage[] }) => m.responseMessages[i].value as any;
const { registry } = loaded;

describe("shop scenario decoding", () => {
  it("decodes every call with the schema", () => {
    for (const call of decoded) {
      expect(call.schemaFound, call.path).toBe(true);
      for (const m of [...call.requestMessages, ...call.responseMessages]) {
        expect(["schema", "json"], call.path).toContain(m.via);
        expect(m.unknownFields, call.path).toBeUndefined();
      }
    }
    expect(decoded.map((c) => `${c.transport} ${c.status.name}`)).toEqual([
      "connect OK",
      "grpc-web OK",
      "connect OK",
      "connect OK",
      "grpc-web OK",
      "grpc-web NOT_FOUND",
      "grpc-web OK",
      "connect OK",
      "connect INVALID_ARGUMENT",
      "grpc-web FAILED_PRECONDITION",
      "connect OK",
      "connect-stream OK",
    ]);
  });

  it("handles maps of messages, Struct, wrappers, oneofs, json_name and recursion", () => {
    const product = response()(getTee).product;
    expect(product.regionalPrices.US).toEqual({ currencyCode: "USD", units: "24", nanos: 990000000 });
    expect(product.attributes).toEqual({ material: "organic cotton", fit: "relaxed" });
    expect(product.metadata).toEqual({
      season: "SS26",
      campaigns: ["spring-sale", "eco-week"],
      weightGrams: { s: 180, m: 200, l: 215 },
      limited: true,
      retired: null,
    });
    expect(product.barcode).toBe("4901234567894");
    expect(product.inStockQuantity).toBe(15);
    expect(product.label).toBe("Bestseller");
    // ACTIVE and PUBLISHED share number 2 (allow_alias), so the wire cannot tell them apart;
    // like protoc-based JSON, the first declared name is shown.
    expect(product.statusHistory).toEqual(["PRODUCT_STATUS_DRAFT", "PRODUCT_STATUS_ACTIVE"]);
    expect(product.status).toBe("PRODUCT_STATUS_ACTIVE");
    expect(product.variants[2]).toMatchObject({ color: "COLOR_INDIGO", size: "SIZE_S", priceDelta: { units: "-300" } });
    expect(product.category.children[0].children[0].displayName).toBe("T-shirts");
  });

  it("keeps every scalar type exact", () => {
    expect(response()(getTee).product.stats).toEqual({
      rating: 4.599999904632568,
      popularity: 0.873,
      viewCount: "9007199254740993",
      reviewCount: 128,
      rankDelta: -3,
      stockDelta: "-120",
      imageCrc: 3735928559,
      contentHash: "18369614221190020847", // 0xfeedfacecafebeef
      temperatureOffset: -2,
      ledgerBalance: "-9007199254740993",
      featured: true,
      thumbnail: "iVBORw0KGgo=",
    });
  });

  it("decodes Connect GET requests with a FieldMask, and unset optional fields", () => {
    expect(getMugMasked.raw.httpMethod).toBe("GET");
    expect(getMugMasked.requestMessages[0].value).toEqual({
      name: "products/mug-002",
      readMask: "title,price,restockTime",
    });
    const mug = response()(getMugMasked).product;
    expect(mug).not.toHaveProperty("description");
    expect(mug.restockTime).toBe("2026-01-29T09:30:00Z");
  });

  it("shows empty responses and wrappers in requests", () => {
    expect(update.requestMessages[0].value).toMatchObject({ updateMask: "tags,description", expectedRevision: "1" });
    expect(response()(del)).toEqual({});
    expect(notFound.status).toMatchObject({ code: 5, message: "products/nope not found" });
  });

  it("decodes oneof events in streams", () => {
    expect(watch.responseMessages.map((m) => Object.keys(m.value as object).find((k) => k !== "eventTime"))).toEqual([
      "stockChanged",
      "priceChanged",
      "stockChanged",
      "archivedProduct",
    ]);
    expect(track.responseMessages.map((m) => (m.value as any).state)).toEqual([
      "ORDER_STATE_PAID",
      "ORDER_STATE_SHIPPED",
      "ORDER_STATE_DELIVERED",
    ]);
  });

  it("expands Any, Value maps and Durations in orders", () => {
    const order = response()(create).order;
    expect(order.extensions).toEqual([{ "@type": "type.googleapis.com/shop.v1.GiftWrap", paper: "kraft", message: "Enjoy!" }]);
    expect(order.labels).toEqual({ channel: "web", priority: 2, giftable: true, coupons: ["SPRING10"] });
    expect(order.deliveryEstimate).toBe("172800s");
    expect(order.card).toEqual({ brand: "visa", last4: "4242" });
    expect(response()(getOrder).order.bankTransfer.bankCode).toBe("0001");
  });

  it("decodes error details the same way for Connect and gRPC-Web", () => {
    expect(invalid.status.details).toEqual([
      {
        type: "shop.v1.ValidationError",
        value: {
          violations: [
            { field: "items[0].quantity", description: "must be positive" },
            { field: "items[0].sku", description: "unknown SKU NOPE-1" },
            { field: "shipping_address", description: "is required" },
          ],
        },
      },
    ]);
    // gRPC-Web sends a google.rpc.Status in grpc-status-details-bin.
    expect(outOfStock.status.details).toEqual([{ type: "shop.v1.OutOfStock", value: { sku: "TEE-001-WHT-L", requested: 1 } }]);
  });

  it("falls back to a schemaless guess for details whose type is not registered", () => {
    expect(decodeCall(shopCalls[9], SchemaIndex.empty).status.details).toEqual([
      { type: "shop.v1.OutOfStock", value: { 1: "TEE-001-WHT-L", 2: 1 } },
    ]);
  });
});

describe("shop schema introspection", () => {
  const product = registry.getMessage("shop.v1.Product")!;
  const field = (name: string) => product.fields.find((f) => f.name === name)!;

  it("describes fields with cross-file and nested types", () => {
    expect(fieldTypeName(field("regional_prices"))).toBe("map<string, common.v1.Money>");
    expect(fieldTypeName(field("variants"))).toBe("shop.v1.Product.Variant");
    expect(fieldLabel(field("description"))).toBe("optional");
    expect(field("short_label").jsonName).toBe("label");
    expect(getComment(registry.getMessage("common.v1.Money")!)).toBe(
      "An amount of money in a currency, in the style of google.type.Money.",
    );
  });

  it("maps JSON paths through lists, maps, nesting and recursion", () => {
    expect(fieldAt(product, ["variants", "0", "priceDelta", "units"])?.parent.typeName).toBe("common.v1.Money");
    expect(fieldAt(product, ["regionalPrices", "US", "nanos"])?.name).toBe("nanos");
    expect(fieldAt(product, ["label"])?.name).toBe("short_label");
    expect(fieldAt(product, ["category", "children", "0", "children", "0", "displayName"])?.name).toBe("display_name");
    // Struct contents are free-form JSON, not schema fields.
    expect(fieldAt(product, ["metadata", "season"])).toBeUndefined();
  });

  it("lists shared types where they are used across files", () => {
    const usages = buildUsages(registry).get("common.v1.Money")!.map((u) => u.label);
    expect(usages).toEqual(
      expect.arrayContaining(["Product.price", "Product.regional_prices", "Variant.price_delta", "LineItem.unit_price", "Order.total"]),
    );
  });

  it("builds a tree with shared packages first and well-known types last", () => {
    const tree = buildTree(registry);
    expect(tree.map((p) => p.label)).toEqual(["common.v1", "demo.v1", "shop.v1", "google.protobuf"]);
    const productNode = tree[2].children.find((n) => n.label === "Product")!;
    expect(productNode.children.map((n) => n.label)).toEqual(["Variant", "Color"]);
    expect(productNode.children[0].children.map((n) => n.label)).toEqual(["Size"]);
  });
});
