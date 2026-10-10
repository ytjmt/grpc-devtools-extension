import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toBufCurl, toGrpcurl } from "../../extension/src/core/curl";
import { decodeCall } from "../../extension/src/core/decode";
import { loadDescriptorSet, SchemaIndex } from "../../extension/src/core/schema";
import { demoCalls, frame, greetReq, raw } from "../fixtures/builders";

const schemas = SchemaIndex.of(loadDescriptorSet(readFileSync(new URL("../../example/descriptor.binpb", import.meta.url))));
const [connectGreet, , grpcWebGreet] = demoCalls.map((c) => decodeCall(c, schemas));
const fileSchema = { kind: "file" as const, name: "descriptor.binpb" };
const urlSchema = { kind: "url" as const, name: "x", url: "http://localhost:8080/_devtools/descriptor.binpb" };
const DATA = `-d '{"name":"ytjmt","bigNumber":"9007199254740993","blob":"AP/+gMMofw==","tags":["a","b"],"scores":{"math":90,"art":-1},"email":"x@example.com"}'`;

describe("toBufCurl", () => {
  it("reproduces a gRPC-Web call with its schema", () => {
    expect(toBufCurl(grpcWebGreet, urlSchema)).toBe(
      [
        "buf curl",
        "--schema 'http://localhost:8080/_devtools/descriptor.binpb'",
        "--protocol grpcweb",
        DATA,
        "'http://localhost:8080/demo.v1.DemoService/Greet'",
      ].join(" \\\n  "),
    );
  });

  it("uses Connect by default and relies on reflection without a schema", () => {
    expect(toBufCurl(connectGreet)).toBe(
      ["buf curl", DATA, "'http://localhost:8080/demo.v1.DemoService/Greet'"].join(" \\\n  "),
    );
  });

  it("keeps app headers, drops browser ones, and escapes quotes", () => {
    const call = decodeCall(
      raw({
        contentType: "application/grpc-web+proto",
        reqBody: frame(0, greetReq),
        requestHeaders: [
          { name: "Authorization", value: "Bearer it's-me" },
          { name: "User-Agent", value: "Chrome" },
          { name: "Sec-Fetch-Mode", value: "cors" },
          { name: ":authority", value: "localhost" },
        ],
      }),
      schemas,
    );
    const cmd = toBufCurl(call, fileSchema)!;
    expect(cmd).toContain(`-H 'Authorization: Bearer it'\\''s-me'`);
    expect(cmd).not.toMatch(/User-Agent|Sec-Fetch|authority|Content-Type/);
    expect(cmd).toContain("--schema 'descriptor.binpb'");
  });

  it("is unavailable when the request was not decoded with a schema", () => {
    const schemaless = decodeCall(demoCalls[2], SchemaIndex.empty);
    expect(toBufCurl(schemaless)).toBeUndefined();
    expect(toGrpcurl(schemaless)).toBeUndefined();
  });
});

describe("toGrpcurl", () => {
  it("targets host:port with the service/method and a local protoset", () => {
    expect(toGrpcurl(grpcWebGreet, urlSchema)).toBe(
      ["grpcurl", "-plaintext", "-protoset 'descriptor.binpb'", DATA, "localhost:8080", "demo.v1.DemoService/Greet"].join(
        " \\\n  ",
      ),
    );
  });

  it("defaults to port 443 over TLS", () => {
    const call = decodeCall(
      raw({
        url: "https://api.example.com/demo.v1.DemoService/Greet",
        contentType: "application/grpc-web+proto",
        reqBody: frame(0, greetReq),
      }),
      schemas,
    );
    expect(toGrpcurl(call, fileSchema)).toContain("api.example.com:443");
    expect(toGrpcurl(call, fileSchema)).not.toContain("-plaintext");
  });
});
