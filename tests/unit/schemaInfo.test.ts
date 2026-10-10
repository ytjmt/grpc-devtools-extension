import { readFileSync } from "node:fs";
import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { GreetResponseSchema, Mood } from "../../example/gen/demo/v1/demo_pb";
import { getComment } from "../../extension/src/core/comments";
import { decodeCall } from "../../extension/src/core/decode";
import { fieldAt, fieldLabel, fieldTypeName, fieldTypeRef } from "../../extension/src/core/fields";
import { loadDescriptorSet, SchemaIndex } from "../../extension/src/core/schema";
import { concat, frame, raw } from "../fixtures/builders";

const load = (file: string) => loadDescriptorSet(readFileSync(new URL(`../../example/${file}`, import.meta.url)));
const { registry } = load("descriptor.binpb");
const req = registry.getMessage("demo.v1.GreetRequest")!;
const res = registry.getMessage("demo.v1.GreetResponse")!;
const field = (name: string) => req.fields.find((f) => f.name === name)!;

describe("getComment", () => {
  it("reads comments for every kind of declaration", () => {
    const svc = registry.getService("demo.v1.DemoService")!;
    const mood = registry.getEnum("demo.v1.Mood")!;
    expect(getComment(svc)).toBe("Demo service used by the example app and the tests.");
    expect(getComment(svc.methods[2])).toBe("Streams 1..up_to, waiting delay_ms between messages.");
    expect(getComment(req)).toBe("Request for DemoService.Greet.");
    expect(getComment(field("big_number"))).toBe("Above 2^53, to check that int64 stays exact in JSON.");
    expect(getComment(req.oneofs[0])).toBe("How to reach the person being greeted.");
    expect(getComment(mood)).toBe("How the greeter feels.");
    expect(getComment(mood.values[2])).toBe("Needs coffee.");
    expect(getComment(field("tags"))).toBeUndefined();
  });

  it("returns nothing when the descriptor has no source info", () => {
    const protoc = load("descriptor.protoc.binpb").registry.getMessage("demo.v1.GreetRequest")!;
    expect(getComment(protoc)).toBeUndefined();
  });
});

describe("field helpers", () => {
  it("spells types as in .proto", () => {
    expect(fieldTypeName(field("name"))).toBe("string");
    expect(fieldTypeName(field("tags"))).toBe("string");
    expect(fieldLabel(field("tags"))).toBe("repeated");
    expect(fieldTypeName(field("scores"))).toBe("map<string, int32>");
    expect(fieldLabel(field("scores"))).toBeUndefined();
    expect(fieldTypeName(res.fields.find((f) => f.name === "mood")!)).toBe("demo.v1.Mood");
    expect(fieldTypeRef(res.fields.find((f) => f.name === "extra")!)).toBe("google.protobuf.Any");
    expect(field("nickname").deprecated).toBe(true);
  });

  it("finds the field for a JSON path", () => {
    expect(fieldAt(req, ["bigNumber"])?.name).toBe("big_number");
    expect(fieldAt(req, ["big_number"])?.name).toBe("big_number");
    expect(fieldAt(req, ["tags", "1"])?.name).toBe("tags");
    expect(fieldAt(req, ["scores", "math"])?.name).toBe("scores");
    expect(fieldAt(res, ["extra"])?.name).toBe("extra");
    // Inside Any the JSON no longer follows the declared type.
    expect(fieldAt(res, ["extra", "text"])).toBeUndefined();
    expect(fieldAt(req, ["nope"])).toBeUndefined();
  });
});

describe("unknown fields", () => {
  it("reports wire fields the schema does not define", () => {
    const known = toBinary(GreetResponseSchema, create(GreetResponseSchema, { greeting: "hi", mood: Mood.HAPPY }));
    // Field 9 (varint 1) is not in GreetResponse: as if the server's proto were newer.
    const withExtra = concat(known, new Uint8Array([9 << 3, 1]));
    const call = decodeCall(
      raw({ contentType: "application/grpc-web+proto", resBody: frame(0, withExtra) }),
      SchemaIndex.of(load("descriptor.binpb")),
    );
    expect(call.responseMessages[0]).toMatchObject({
      via: "schema",
      value: { greeting: "hi", mood: "MOOD_HAPPY" },
      unknownFields: [{ path: "", number: 9 }],
    });
  });

  it("leaves matching messages alone", () => {
    const call = decodeCall(
      raw({
        contentType: "application/grpc-web+proto",
        resBody: frame(0, toBinary(GreetResponseSchema, create(GreetResponseSchema, { greeting: "hi" }))),
      }),
      SchemaIndex.of(load("descriptor.binpb")),
    );
    expect(call.responseMessages[0].unknownFields).toBeUndefined();
  });
});
