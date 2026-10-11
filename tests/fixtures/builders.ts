import { create, toBinary } from "@bufbuild/protobuf";
import { anyPack } from "@bufbuild/protobuf/wkt";
import {
  CountResponseSchema,
  GreetRequestSchema,
  GreetResponseSchema,
  Mood,
  NoteSchema,
} from "../../example/gen/demo/v1/demo_pb";
import { bytesToBase64 } from "../../extension/src/core/bytes";
import type { Header, RawCall } from "../../extension/src/core/types";
import demoCallsJson from "./demo-calls.json";
import compressionCallsJson from "./compression-calls.json";
import shopCallsJson from "./shop-calls.json";

/** Real calls captured from the demo app by `pnpm fixtures:record`. */
export const demoCalls = demoCallsJson as RawCall[];

/**
 * The shop scenario (?auto=shop): common.v1 + shop.v1 types over every transport,
 * in this order: ListProducts, GetProduct, GetProduct (GET + read_mask), UpdateProduct,
 * DeleteProduct, GetProduct (NOT_FOUND), WatchInventory, CreateOrder, CreateOrder
 * (INVALID_ARGUMENT), CreateOrder (FAILED_PRECONDITION), GetOrder (GET), TrackOrder.
 */
export const shopCalls = shopCallsJson as RawCall[];

/**
 * RPC-level compression (?auto=compression), in this order: gRPC-Web gzip both ways,
 * Connect stream gzip both ways, Connect unary with a gzip request body (which Chrome
 * records decompressed), Connect GET with compression=gzip, gRPC-Web brotli response.
 */
export const compressionCalls = compressionCallsJson as RawCall[];

export const utf8 = (s: string) => new TextEncoder().encode(s);
const latin1 = (b: Uint8Array) => String.fromCharCode(...b);

export function frame(flags: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + data.length);
  out[0] = flags;
  new DataView(out.buffer).setUint32(1, data.length);
  out.set(data, 5);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const greetReq = toBinary(
  GreetRequestSchema,
  create(GreetRequestSchema, {
    name: "ytjmt",
    bigNumber: 9007199254740993n,
    blob: new Uint8Array([0x00, 0xff, 0x80]),
    contact: { case: "email", value: "x@example.com" },
  }),
);
export const greetRes = toBinary(
  GreetResponseSchema,
  create(GreetResponseSchema, { greeting: "hi", mood: Mood.HAPPY }),
);
export const countRes = (n: number) => toBinary(CountResponseSchema, create(CountResponseSchema, { n }));

let nextId = 1000;

/** Builds a RawCall the way capture.ts would store it. */
export function raw(
  p: Partial<RawCall> & { contentType: string; reqBody?: Uint8Array; resBody?: Uint8Array },
): RawCall {
  const { contentType, reqBody, resBody, ...rest } = p;
  return {
    id: nextId++,
    url: "http://localhost:8080/demo.v1.DemoService/Greet",
    httpMethod: "POST",
    startedDateTime: "2026-01-01T00:00:00.000Z",
    time: 12,
    httpStatus: 200,
    responseHeaders: [],
    requestBodyText: reqBody ? latin1(reqBody) : null,
    responseBody: resBody ? { content: bytesToBase64(resBody), encoding: "base64" } : { content: null, encoding: "" },
    ...rest,
    requestHeaders: [{ name: "Content-Type", value: contentType }, ...(rest.requestHeaders ?? [])],
  };
}

const trailers = (lines: Header[]) => frame(0x80, utf8(lines.map((h) => `${h.name}: ${h.value}\r\n`).join("")));

/** Cases the demo server cannot produce, built by hand. */
export const syntheticCalls = {
  grpcWebText: (): RawCall => ({
    ...raw({ contentType: "application/grpc-web-text" }),
    requestBodyText: bytesToBase64(frame(0, greetReq)),
    // Two separately padded base64 chunks, as some proxies stream them.
    responseBody: {
      content: bytesToBase64(frame(0, greetRes)) + bytesToBase64(trailers([{ name: "grpc-status", value: "0" }])),
      encoding: "",
    },
  }),

  trailersOnlyError: (): RawCall =>
    raw({
      url: "http://localhost:8080/demo.v1.DemoService/Fail",
      contentType: "application/grpc-web+proto",
      reqBody: frame(0, greetReq),
      responseHeaders: [
        { name: "grpc-status", value: "16" },
        { name: "grpc-message", value: "token%20expired" },
      ],
    }),

  connectGet: (): RawCall =>
    raw({
      contentType: "",
      httpMethod: "GET",
      url: `http://localhost:8080/demo.v1.DemoService/Greet?connect=v1&encoding=proto&base64=1&message=${bytesToBase64(greetReq).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`,
      resBody: greetRes,
    }),

  connectStreamError: (): RawCall =>
    raw({
      url: "http://localhost:8080/demo.v1.DemoService/Count",
      contentType: "application/connect+proto",
      reqBody: frame(0, new Uint8Array([8, 3])),
      resBody: concat(
        frame(0, countRes(1)),
        frame(0, countRes(2)),
        frame(
          2,
          utf8(
            JSON.stringify({
              error: { code: "unavailable", message: "server shutting down" },
              metadata: { "x-request-id": ["abc"] },
            }),
          ),
        ),
      ),
      time: 900,
    }),

  compressedFrame: (): RawCall =>
    raw({
      contentType: "application/grpc-web+proto",
      reqBody: frame(1, new Uint8Array([0x1f, 0x8b, 0x08])),
      resBody: concat(frame(0, greetRes), trailers([{ name: "grpc-status", value: "0" }])),
    }),

  truncatedResponse: (): RawCall =>
    raw({
      contentType: "application/grpc-web+proto",
      reqBody: frame(0, greetReq),
      resBody: frame(0, greetRes).subarray(0, 10),
    }),

  /** Response carrying field 9, which the demo schema does not define (as if the server were newer). */
  unknownFields: (): RawCall =>
    raw({
      contentType: "application/grpc-web+proto",
      reqBody: frame(0, greetReq),
      resBody: concat(
        frame(0, concat(greetRes, new Uint8Array([9 << 3, 1]))),
        trailers([{ name: "grpc-status", value: "0" }]),
      ),
    }),

  withAny: (): RawCall =>
    raw({
      contentType: "application/grpc-web+proto",
      reqBody: frame(0, greetReq),
      resBody: concat(
        frame(
          0,
          toBinary(
            GreetResponseSchema,
            create(GreetResponseSchema, {
              greeting: "hello",
              mood: Mood.SLEEPY,
              at: { seconds: 1767225600n, nanos: 0 },
              extra: anyPack(NoteSchema, create(NoteSchema, { text: "nested note" })),
            }),
          ),
        ),
        trailers([{ name: "grpc-status", value: "0" }]),
      ),
    }),
};
