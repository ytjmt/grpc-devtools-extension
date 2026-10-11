import { createRegistry } from "@bufbuild/protobuf";
import { anyPack } from "@bufbuild/protobuf/wkt";
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport, createGrpcWebTransport } from "@connectrpc/connect-web";
import { CatalogService, ProductStatus } from "../gen/shop/v1/catalog_pb";
import { GiftWrapSchema, OrderService } from "../gen/shop/v1/order_pb";

const baseUrl = location.origin;
// Any payloads in JSON need their types registered.
const jsonOptions = { registry: createRegistry(GiftWrapSchema) };

const transports = {
  connect: createConnectTransport({ baseUrl, useBinaryFormat: true }),
  connectJson: createConnectTransport({ baseUrl, jsonOptions }),
  // Side-effect-free methods (idempotency_level = NO_SIDE_EFFECTS) go over HTTP GET.
  connectGet: createConnectTransport({ baseUrl, useBinaryFormat: true, useHttpGet: true }),
  grpcWeb: createGrpcWebTransport({ baseUrl }),
};
const catalog = (t: keyof typeof transports) => createClient(CatalogService, transports[t]);
const orders = (t: keyof typeof transports) => createClient(OrderService, transports[t]);

const address = {
  regionCode: "JP",
  postalCode: "150-0001",
  administrativeArea: "Tokyo",
  locality: "Shibuya-ku",
  addressLines: ["Jingumae 1-2-3", "Room 405"],
  recipients: ["Hanako Yamada"],
};

async function collect<T>(stream: AsyncIterable<T>): Promise<number> {
  let n = 0;
  for await (const _ of stream) n++;
  return n;
}

/** A realistic session against the shop services, one RPC per entry. */
export const shopCalls: Record<string, () => Promise<unknown>> = {
  "catalog: ListProducts (connect)": () =>
    catalog("connect")
      .listProducts({
        page: { pageSize: 2 },
        statuses: [ProductStatus.ACTIVE],
        maxPrice: { currencyCode: "JPY", units: 5000n },
      })
      .then((r) => r.products.map((p) => p.name)),
  "catalog: GetProduct (grpc-web)": () =>
    catalog("grpcWeb")
      .getProduct({ name: "products/tee-001" })
      .then((r) => r.product?.title),
  "catalog: GetProduct with read_mask (connect GET)": () =>
    catalog("connectGet")
      .getProduct({ name: "products/mug-002", readMask: { paths: ["title", "price", "restock_time"] } })
      .then((r) => r.product?.title),
  "catalog: UpdateProduct (connect json)": () =>
    catalog("connectJson")
      .updateProduct({
        product: { name: "products/poster-003", tags: ["art", "limited"], description: "A2, two colors" },
        updateMask: { paths: ["tags", "description"] },
        expectedRevision: 1n,
      })
      .then((r) => r.product?.audit?.revision),
  "catalog: DeleteProduct (grpc-web)": () => catalog("grpcWeb").deleteProduct({ name: "products/poster-003" }),
  "catalog: GetProduct not found (grpc-web)": () => catalog("grpcWeb").getProduct({ name: "products/nope" }),
  "catalog: WatchInventory (grpc-web stream)": () =>
    collect(catalog("grpcWeb").watchInventory({ skus: ["TEE-001-BLK-M"], interval: { nanos: 100_000_000 } })),
  "orders: CreateOrder (connect)": () =>
    orders("connect")
      .createOrder({
        items: [{ sku: "TEE-001-BLK-M", quantity: 2 }],
        shippingAddress: address,
        payment: { case: "card", value: { brand: "visa", last4: "4242" } },
        extensions: [anyPack(GiftWrapSchema, create(GiftWrapSchema, { paper: "kraft", message: "Enjoy!" }))],
        requestId: "req-7f3a",
      })
      .then((r) => r.order?.name),
  "orders: CreateOrder invalid (connect json)": () =>
    orders("connectJson").createOrder({ items: [{ sku: "NOPE-1", quantity: 0 }] }),
  "orders: CreateOrder out of stock (grpc-web)": () =>
    orders("grpcWeb").createOrder({
      items: [{ sku: "TEE-001-WHT-L", quantity: 1 }],
      shippingAddress: address,
      payment: { case: "cashOnDelivery", value: {} },
    }),
  "orders: GetOrder (connect GET)": () =>
    orders("connectGet")
      .getOrder({ name: "orders/2001" })
      .then((r) => r.order?.state),
  "orders: TrackOrder (connect stream)": () => collect(orders("connect").trackOrder({ name: "orders/2001" })),
};
