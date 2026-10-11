import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { decodeCall } from "../../extension/src/core/decode";
import { loadDescriptorSet, SchemaIndex, type IndexedSchema } from "../../extension/src/core/schema";
import { defaultScopeFor, isValidScope, matchesScope, parseScopes } from "../../extension/src/core/scope";
import { frame, greetRes, raw } from "../fixtures/builders";

describe("scope patterns", () => {
  it("matches whole request URLs with * wildcards", () => {
    expect(matchesScope("http://localhost:8080/*", "http://localhost:8080/demo.v1.DemoService/Greet")).toBe(true);
    expect(matchesScope("http://localhost:8080/*", "http://localhost:9090/demo.v1.DemoService/Greet")).toBe(false);
    expect(matchesScope("https://*.stg.example.com/*", "https://api.stg.example.com/a.B/C")).toBe(true);
    expect(matchesScope("https://*.stg.example.com/*", "https://api.example.com/a.B/C")).toBe(false);
    expect(matchesScope("*://api.example.com/v2/*", "http://api.example.com/v2/a.B/C")).toBe(true);
    // Dots are literal, not regex wildcards.
    expect(matchesScope("https://api.example.com/*", "https://apixexample.com/a.B/C")).toBe(false);
  });

  it("parses user input and fills in a missing path", () => {
    expect(parseScopes(" http://localhost:8080 \nhttps://api.example.com/*,https://api.example.com/*\n\n")).toEqual([
      "http://localhost:8080/*",
      "https://api.example.com/*",
    ]);
  });

  it("validates patterns", () => {
    expect(isValidScope("http://localhost:8080/*")).toBe(true);
    expect(isValidScope("*://*.example.com/*")).toBe(true);
    expect(isValidScope("localhost:8080")).toBe(false);
    expect(isValidScope("ftp://example.com/*")).toBe(false);
  });

  it("suggests the descriptor's origin as default scope", () => {
    expect(defaultScopeFor("http://localhost:8080/_devtools/descriptor.binpb")).toBe("http://localhost:8080/*");
  });
});

describe("SchemaIndex.resolve", () => {
  const loaded = loadDescriptorSet(readFileSync(new URL("../../example/descriptor.binpb", import.meta.url)));
  const schema = (name: string, scopes: string[] = []): IndexedSchema => ({ id: name, name, scopes, loaded });
  const LOCAL = "http://localhost:8080/demo.v1.DemoService/Greet";
  const STG = "https://api.stg.example.com/demo.v1.DemoService/Greet";

  it("prefers a scoped match over unscoped schemas, regardless of order", () => {
    const index = new SchemaIndex([schema("global"), schema("local", ["http://localhost:8080/*"])]);
    // An overridden unscoped fallback is intended, so it is not reported as shadowed.
    expect(index.resolve(LOCAL, "demo.v1.DemoService", "Greet")).toMatchObject({
      schema: { name: "local" },
      shadowed: [],
      outOfScope: [],
    });
    expect(index.resolve(STG, "demo.v1.DemoService", "Greet")).toMatchObject({
      schema: { name: "global" },
      shadowed: [],
    });
  });

  it("reports ambiguity only within the same priority", () => {
    const unscoped = new SchemaIndex([schema("a"), schema("b")]);
    expect(unscoped.resolve(LOCAL, "demo.v1.DemoService", "Greet")).toMatchObject({
      schema: { name: "a" },
      shadowed: ["b"],
    });

    const disjoint = new SchemaIndex([
      schema("local", ["http://localhost:8080/*"]),
      schema("stg", ["https://*.stg.example.com/*"]),
    ]);
    expect(disjoint.resolve(LOCAL, "demo.v1.DemoService", "Greet")).toMatchObject({
      schema: { name: "local" },
      shadowed: [],
    });
    expect(disjoint.resolve(STG, "demo.v1.DemoService", "Greet")).toMatchObject({
      schema: { name: "stg" },
      shadowed: [],
    });
  });

  it("reports schemas that define the service but are out of scope", () => {
    const index = new SchemaIndex([schema("stg", ["https://*.stg.example.com/*"])]);
    const r = index.resolve(LOCAL, "demo.v1.DemoService", "Greet");
    expect(r.method).toBeUndefined();
    expect(r.outOfScope).toEqual(["stg"]);
  });

  it("flows into the decoded call", () => {
    const scoped = decodeCall(
      raw({ url: LOCAL, contentType: "application/grpc-web+proto", resBody: frame(0, greetRes) }),
      new SchemaIndex([schema("global"), schema("local", ["http://localhost:8080/*"])]),
    );
    expect(scoped).toMatchObject({ schemaName: "local", warnings: [] });

    const ambiguous = decodeCall(
      raw({ url: LOCAL, contentType: "application/grpc-web+proto", resBody: frame(0, greetRes) }),
      new SchemaIndex([schema("a"), schema("b")]),
    );
    expect(ambiguous.warnings).toEqual([
      { key: "warn.schemaShadowed", params: { service: "demo.v1.DemoService", used: "a", others: "b" } },
    ]);

    const outOfScope = decodeCall(
      raw({ url: LOCAL, contentType: "application/grpc-web+proto", resBody: frame(0, greetRes) }),
      new SchemaIndex([schema("stg", ["https://*.stg.example.com/*"])]),
    );
    expect(outOfScope).toMatchObject({ schemaFound: false, schemaName: undefined, outOfScopeSchemas: ["stg"] });
    expect(outOfScope.responseMessages[0].via).toBe("schemaless");
  });
});
