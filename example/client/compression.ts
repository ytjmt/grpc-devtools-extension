import { create, toBinary } from "@bufbuild/protobuf";
import { GetProductRequestSchema, ListProductsRequestSchema, WatchInventoryRequestSchema } from "../gen/shop/v1/catalog_pb";

// connect-web does not compress, so these calls are hand-rolled with fetch, as a
// client that supports RPC-level compression would send them.

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function frame(flags: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + data.length);
  out[0] = flags;
  new DataView(out.buffer).setUint32(1, data.length);
  out.set(data, 5);
  return out;
}

const base64Url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function post(path: string, headers: Record<string, string>, body: Uint8Array) {
  const res = await fetch(path, { method: "POST", headers, body: body as BodyInit });
  return `${res.status} ${(await res.arrayBuffer()).byteLength} bytes`;
}

const tee = () => toBinary(GetProductRequestSchema, create(GetProductRequestSchema, { name: "products/tee-001" }));

export const compressionCalls: Record<string, () => Promise<unknown>> = {
  "grpc-web: GetProduct, gzip both ways": async () =>
    post(
      "/shop.v1.CatalogService/GetProduct",
      {
        "content-type": "application/grpc-web+proto",
        "x-grpc-web": "1",
        "grpc-encoding": "gzip",
        "grpc-accept-encoding": "gzip",
      },
      frame(1, await gzip(tee())),
    ),
  "connect stream: WatchInventory, gzip both ways": async () =>
    post(
      "/shop.v1.CatalogService/WatchInventory",
      {
        "content-type": "application/connect+proto",
        "connect-protocol-version": "1",
        "connect-content-encoding": "gzip",
        "connect-accept-encoding": "gzip",
      },
      frame(
        1,
        await gzip(
          toBinary(
            WatchInventoryRequestSchema,
            create(WatchInventoryRequestSchema, { skus: ["TEE-001-BLK-M"], interval: { nanos: 50_000_000 } }),
          ),
        ),
      ),
    ),
  "connect: ListProducts, gzip request body": async () =>
    post(
      "/shop.v1.CatalogService/ListProducts",
      { "content-type": "application/proto", "connect-protocol-version": "1", "content-encoding": "gzip" },
      await gzip(toBinary(ListProductsRequestSchema, create(ListProductsRequestSchema, { page: { pageSize: 1 } }))),
    ),
  "connect GET: GetProduct, compression=gzip": async () => {
    const message = base64Url(await gzip(tee()));
    const res = await fetch(
      `/shop.v1.CatalogService/GetProduct?connect=v1&encoding=proto&base64=1&compression=gzip&message=${message}`,
    );
    return `${res.status} ${(await res.arrayBuffer()).byteLength} bytes`;
  },
  "grpc-web: GetProduct, brotli response": async () =>
    post(
      "/shop.v1.CatalogService/GetProduct",
      { "content-type": "application/grpc-web+proto", "x-grpc-web": "1", "grpc-accept-encoding": "br" },
      frame(0, tee()),
    ),
};
