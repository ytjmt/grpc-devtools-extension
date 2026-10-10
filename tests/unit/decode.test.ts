import { readFileSync } from "node:fs";
import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { GreetRequestSchema, GreetResponseSchema } from "../../example/gen/demo/v1/demo_pb";
import { decodeCall } from "../../extension/src/core/decode";
import { detectProtocol } from "../../extension/src/core/framing";
import type { DecodedMessage } from "../../extension/src/core/types";
import { loadDescriptorSet, SchemaIndex } from "../../extension/src/core/schema";
import { decodeSchemaless } from "../../extension/src/core/schemaless";
import {
  concat,
  demoCalls,
  frame,
  greetReq,
  greetRes,
  raw,
  syntheticCalls,
  utf8,
} from "../fixtures/builders";

const descriptor = readFileSync(new URL("../../example/descriptor.binpb", import.meta.url));
const schemas = SchemaIndex.of(loadDescriptorSet(descriptor));

describe("decodeCall", () => {
  it("decodes grpc-web unary with schema", () => {
    const call = decodeCall(
      raw({
        contentType: "application/grpc-web+proto",
        reqBody: frame(0, greetReq),
        resBody: concat(frame(0, greetRes), frame(0x80, utf8("grpc-status: 0\r\ngrpc-message: \r\n"))),
      }),
      schemas,
    );
    expect(call.path).toBe("/demo.v1.DemoService/Greet");
    expect(call.schemaFound).toBe(true);
    expect(call.requestMessages[0]).toMatchObject({
      via: "schema",
      typeName: "demo.v1.GreetRequest",
      value: { name: "ytjmt", bigNumber: "9007199254740993", blob: "AP+A", email: "x@example.com" },
    });
    expect(call.responseMessages[0].value).toEqual({ greeting: "hi", mood: "MOOD_HAPPY" });
    expect(call.status).toMatchObject({ code: 0, name: "OK" });
  });

  it("reads status from headers for trailers-only grpc-web errors", () => {
    const call = decodeCall(syntheticCalls.trailersOnlyError(), schemas);
    expect(call.status).toMatchObject({ code: 16, name: "UNAUTHENTICATED", message: "token expired" });
  });

  it("decodes grpc-web-text with chunked base64 response", () => {
    const call = decodeCall(syntheticCalls.grpcWebText(), schemas);
    expect(call.transport).toBe("grpc-web-text");
    expect(call.requestMessages[0].value).toMatchObject({ name: "ytjmt" });
    expect(call.responseMessages[0].value).toMatchObject({ greeting: "hi" });
    expect(call.status.code).toBe(0);
  });

  it("decodes connect unary proto and JSON errors", () => {
    const okCall = decodeCall(
      raw({
        contentType: "application/proto",
        requestHeaders: [{ name: "connect-protocol-version", value: "1" }],
        reqBody: greetReq,
        resBody: greetRes,
      }),
      schemas,
    );
    expect(okCall.transport).toBe("connect");
    expect(okCall.responseMessages[0].value).toMatchObject({ greeting: "hi" });

    const errCall = decodeCall(
      raw({
        contentType: "application/proto",
        reqBody: greetReq,
        httpStatus: 403,
        resBody: utf8(JSON.stringify({ code: "permission_denied", message: "nope" })),
      }),
      schemas,
    );
    expect(errCall.status).toMatchObject({ code: 7, message: "nope" });
    expect(errCall.responseMessages).toHaveLength(0);
  });

  it("decodes connect GET requests", () => {
    const call = decodeCall(syntheticCalls.connectGet(), schemas);
    expect(call.requestMessages[0].value).toMatchObject({ name: "ytjmt" });
  });

  it("decodes connect server streams with end-of-stream error", () => {
    const call = decodeCall(syntheticCalls.connectStreamError(), schemas);
    expect(call.requestMessages[0].value).toEqual({ upTo: 3 });
    expect(call.responseMessages.map((m) => m.value)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(call.status).toMatchObject({ code: 14, name: "UNAVAILABLE", message: "server shutting down" });
    expect(call.trailers).toEqual([{ name: "x-request-id", value: "abc" }]);
  });

  it("flags compressed frames and truncated bodies", () => {
    expect(decodeCall(syntheticCalls.compressedFrame(), schemas).requestMessages[0]).toMatchObject({
      via: "error",
      error: { key: "warn.compressedFrame" },
    });
    expect(decodeCall(syntheticCalls.truncatedResponse(), schemas).warnings).toEqual([
      { key: "warn.incompleteResponseFrame", params: { bytes: 10 } },
    ]);
  });

  it("falls back to schemaless decoding without a schema", () => {
    const call = decodeCall(
      raw({ contentType: "application/grpc-web+proto", reqBody: frame(0, greetReq) }),
      SchemaIndex.empty,
    );
    expect(call.schemaFound).toBe(false);
    expect(call.requestMessages[0]).toMatchObject({
      via: "schemaless",
      value: { 1: "ytjmt", 2: "9007199254740993", 3: { bytes: "AP+A" }, 6: "x@example.com" },
    });
  });

  it("ignores non-RPC traffic", () => {
    const json = [{ name: "Content-Type", value: "application/json" }];
    expect(detectProtocol("http://x/api/users", "POST", json)).toBeUndefined();
    // JSON to an RPC-shaped path is only Connect when the protocol header is present.
    expect(detectProtocol("http://x/a.B/C", "POST", json)).toBeUndefined();
    expect(detectProtocol("http://x/a.B/C", "POST", [...json, { name: "Connect-Protocol-Version", value: "1" }])).toEqual({
      transport: "connect",
      codec: "json",
    });
  });
});

describe("golden: recorded and synthetic fixtures", () => {
  // `raw` is excluded: it only echoes the input fixture.
  // `type` is a full descriptor object; `typeName` already identifies it.
  const withoutType = (messages: DecodedMessage[]) => messages.map(({ type: _type, ...m }) => m);
  const decodeForSnapshot = (index: SchemaIndex) => (c: (typeof demoCalls)[number]) => {
    const { raw: _raw, ...decoded } = decodeCall(c, index);
    return {
      ...decoded,
      requestMessages: withoutType(decoded.requestMessages),
      responseMessages: withoutType(decoded.responseMessages),
    };
  };

  it("decodes recorded demo calls with the schema", () => {
    expect(demoCalls.map(decodeForSnapshot(schemas))).toMatchSnapshot();
  });

  it("decodes recorded demo calls without a schema", () => {
    expect(demoCalls.map(decodeForSnapshot(SchemaIndex.empty))).toMatchSnapshot();
  });

  it("decodes synthetic calls", () => {
    const decoded = Object.fromEntries(
      Object.entries(syntheticCalls).map(([name, build]) => [name, decodeForSnapshot(schemas)(build())]),
    );
    expect(decoded).toMatchSnapshot();
  });
});

describe("loadDescriptorSet", () => {
  it("lists services", () => {
    expect(loadDescriptorSet(descriptor).services).toEqual(["demo.v1.DemoService"]);
  });

  it("loads protoc output generated without --include_imports", () => {
    // google/protobuf/{any,timestamp}.proto are missing; bundled well-known types fill in.
    const protocOnly = readFileSync(new URL("../../example/descriptor.protoc.binpb", import.meta.url));
    const loaded = loadDescriptorSet(protocOnly);
    expect(loaded.services).toEqual(["demo.v1.DemoService"]);
    expect(loaded.skipped).toEqual([]);
    const call = decodeCall(
      raw({ contentType: "application/grpc-web+proto", resBody: frame(0, greetRes) }),
      SchemaIndex.of(loaded),
    );
    expect(call.responseMessages[0].value).toEqual({ greeting: "hi", mood: "MOOD_HAPPY" });
  });

  it("rejects bytes that are not a FileDescriptorSet", () => {
    expect(() => loadDescriptorSet(new Uint8Array())).toThrow("The FileDescriptorSet contains no files");
  });
});

describe("decodeSchemaless", () => {
  it("treats embedded messages with control bytes as messages, not strings", async () => {
    const { anyPack } = await import("@bufbuild/protobuf/wkt");
    const { NoteSchema } = await import("../../example/gen/demo/v1/demo_pb");
    const bytes = toBinary(
      GreetResponseSchema,
      create(GreetResponseSchema, { greeting: "hi", extra: anyPack(NoteSchema, create(NoteSchema, { text: "tags=a,b" })) }),
    );
    expect(decodeSchemaless(bytes)).toEqual({
      1: "hi",
      4: { 1: "type.googleapis.com/demo.v1.Note", 2: { 1: "tags=a,b" } },
    });
  });

  it("groups repeated fields and decodes negative varints", () => {
    const bytes = toBinary(GreetRequestSchema, create(GreetRequestSchema, { tags: ["a", "b"], bigNumber: -1n }));
    expect(decodeSchemaless(bytes)).toEqual({ 2: -1, 4: ["a", "b"] });
  });

  it("never throws anything but a LocalizedError on random input", async () => {
    const { LocalizedError } = await import("../../extension/src/i18n");
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 2000; i++) {
      const bytes = Uint8Array.from({ length: Math.floor(rand() * 64) }, () => Math.floor(rand() * 256));
      try {
        decodeSchemaless(bytes);
      } catch (e) {
        expect(e).toBeInstanceOf(LocalizedError);
      }
    }
  });
});

