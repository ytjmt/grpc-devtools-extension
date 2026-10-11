import { readFileSync } from "node:fs";
import { deflateSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import { decompressBodies, isCompressed } from "../../extension/src/core/compression";
import { decodeCall } from "../../extension/src/core/decode";
import { loadDescriptorSet, SchemaIndex } from "../../extension/src/core/schema";
import { compressionCalls, concat, frame, greetReq, greetRes, raw, utf8 } from "../fixtures/builders";

const schemas = SchemaIndex.of(loadDescriptorSet(readFileSync(new URL("../../example/descriptor.binpb", import.meta.url))));
const decodeDecompressed = async (c: (typeof compressionCalls)[number]) => decodeCall(c, schemas, await decompressBodies(c));
const vias = (call: ReturnType<typeof decodeCall>) => [...call.requestMessages, ...call.responseMessages].map((m) => m.via);
const grpcWeb = (headers: { name: string; value: string }[], reqBody: Uint8Array, resBody?: Uint8Array) =>
  raw({ contentType: "application/grpc-web+proto", requestHeaders: headers, reqBody, resBody });

describe("recorded compressed traffic", () => {
  it("decodes every call after decompression", async () => {
    const decoded = await Promise.all(compressionCalls.map(decodeDecompressed));
    expect(decoded.map((c) => [c.method, c.transport, c.status.name, vias(c)])).toEqual([
      ["GetProduct", "grpc-web", "OK", ["schema", "schema"]],
      ["WatchInventory", "connect-stream", "OK", ["schema", "schema", "schema", "schema", "schema"]],
      ["ListProducts", "connect", "OK", ["schema", "schema"]],
      ["GetProduct", "connect", "OK", ["schema", "schema"]],
      ["GetProduct", "grpc-web", "OK", ["schema", "schema"]],
    ]);
    expect((decoded[0].responseMessages[0].value as any).product.title).toBe("Organic Cotton Tee");
  });

  it("only flags calls that use RPC-level compression", () => {
    // ListProducts sent Content-Encoding: gzip, but Chrome records the body decompressed.
    expect(compressionCalls.map(isCompressed)).toEqual([true, true, false, true, true]);
  });

  it("reports compressed messages and trailers until they are decompressed", () => {
    const [getProduct, watch] = compressionCalls;
    const before = decodeCall(getProduct, schemas);
    expect(before.requestMessages[0]).toMatchObject({
      via: "error",
      error: { key: "warn.compressed", params: { encoding: "gzip" } },
    });
    expect(before.status.message).toEqual({ key: "status.compressedTrailers", params: { encoding: "gzip" } });
    expect(decodeCall(watch, schemas).status.message).toEqual({
      key: "status.compressedTrailers",
      params: { encoding: "gzip" },
    });
  });
});

describe("decompressBodies", () => {
  it("inflates deflate (zlib) frames", async () => {
    const call = grpcWeb(
      [
        { name: "grpc-encoding", value: "deflate" },
      ],
      frame(1, deflateSync(greetReq)),
    );
    const decoded = decodeCall(call, schemas, await decompressBodies(call));
    expect(decoded.requestMessages[0]).toMatchObject({ via: "schema", value: { name: "ytjmt" } });
  });

  it("leaves uncompressed frames in a compressed stream untouched", async () => {
    // A server may skip compression for small messages even when an encoding is negotiated.
    const call = {
      ...grpcWeb(
        [{ name: "grpc-encoding", value: "gzip" }],
        frame(0, greetReq),
        concat(frame(1, gzipSync(greetRes)), frame(0x80, utf8("grpc-status: 0\r\n"))),
      ),
      responseHeaders: [{ name: "grpc-encoding", value: "gzip" }],
    };
    const decoded = decodeCall(call, schemas, await decompressBodies(call));
    expect(vias(decoded)).toEqual(["schema", "schema"]);
    expect(decoded.status.code).toBe(0);
  });

  it("names unsupported encodings", async () => {
    const call = grpcWeb([{ name: "grpc-encoding", value: "snappy" }], frame(1, new Uint8Array([1, 2, 3])));
    expect(decodeCall(call, schemas, await decompressBodies(call)).requestMessages[0]).toMatchObject({
      via: "error",
      error: { key: "warn.compressed", params: { encoding: "snappy" } },
    });
  });

  it("keeps corrupt data compressed instead of failing the whole call", async () => {
    const call = grpcWeb([{ name: "grpc-encoding", value: "gzip" }], concat(frame(1, utf8("not gzip")), frame(1, gzipSync(greetReq))));
    const decoded = decodeCall(call, schemas, await decompressBodies(call));
    expect(decoded.requestMessages.map((m) => m.via)).toEqual(["error", "schema"]);
  });

  it("inflates a unary Connect request that is still gzip-compressed", async () => {
    const call = raw({
      contentType: "application/proto",
      requestHeaders: [
        { name: "Connect-Protocol-Version", value: "1" },
        { name: "Content-Encoding", value: "gzip" },
      ],
      reqBody: gzipSync(greetReq),
    });
    expect(isCompressed(call)).toBe(true);
    const decoded = decodeCall(call, schemas, await decompressBodies(call));
    expect(decoded.requestMessages[0]).toMatchObject({ via: "schema", value: { name: "ytjmt" } });
  });
});
