import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { loadDescriptorSet, SchemaIndex, type IndexedSchema } from "../../extension/src/core/schema";
import { collectMethodStats, methodKey } from "../../extension/src/panel/methodStats";
import { decodeRow } from "../../extension/src/panel/useDecodedRows";
import { demoCalls } from "../fixtures/builders";

const loaded = loadDescriptorSet(readFileSync(new URL("../../example/descriptor.binpb", import.meta.url)));
const schema = (id: string, scopes: string[] = []): IndexedSchema => ({ id, name: id, scopes, loaded });

describe("collectMethodStats", () => {
  it("counts calls per method with the latest status", () => {
    const stats = collectMethodStats(demoCalls.map((c) => decodeRow(c, new SchemaIndex([schema("demo")]))));
    expect(stats.get(methodKey("demo", "/demo.v1.DemoService/Greet"))).toEqual({ count: 3, last: { code: 0, name: "OK" } });
    expect(stats.get(methodKey("demo", "/demo.v1.DemoService/Fail"))).toMatchObject({
      count: 1,
      last: { code: 7, name: "PERMISSION_DENIED" },
    });
    expect(stats.get(methodKey("demo", "/demo.v1.DemoService/Count"))?.count).toBe(2);
  });

  it("counts a call only under the schema that decoded it", () => {
    const index = new SchemaIndex([schema("global"), schema("local", ["http://localhost:8080/*"])]);
    const stats = collectMethodStats(demoCalls.map((c) => decodeRow(c, index)));
    expect(stats.get(methodKey("local", "/demo.v1.DemoService/Greet"))?.count).toBe(3);
    expect(stats.has(methodKey("global", "/demo.v1.DemoService/Greet"))).toBe(false);
  });

  it("ignores calls decoded without a schema", () => {
    expect(collectMethodStats(demoCalls.map((c) => decodeRow(c, SchemaIndex.empty))).size).toBe(0);
  });
});
