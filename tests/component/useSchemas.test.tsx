import { describe, expect, it } from "vite-plus/test";
import { renderHook } from "vitest-browser-react";
import type { SchemaBackend } from "../../extension/src/panel/schemaBackend";
import { useSchemas } from "../../extension/src/panel/useSchemas";
import { fakeSchemaBackend, loadDescriptor } from "../support/fakeSchemaBackend";
import { demoSchemaSource, descriptorUrl } from "../support/renderPanel";

const URL_A = "http://localhost:8080/a.binpb";
const URL_B = "http://localhost:8080/b.binpb";

async function urlSources() {
  return [
    await demoSchemaSource({ id: "a", name: URL_A, kind: "url", url: URL_A }),
    await demoSchemaSource({ id: "b", name: URL_B, kind: "url", url: URL_B }),
  ];
}

describe("useSchemas", () => {
  it("keeps the parsed schemas and the index when nothing they depend on changed", async () => {
    const bytes = await loadDescriptor(descriptorUrl);
    const { backend } = fakeSchemaBackend({ sources: await urlSources(), urls: { [URL_A]: bytes, [URL_B]: bytes } });
    const { result } = await renderHook(() => useSchemas(backend));
    await expect.poll(() => result.current.index.schemas.length).toBe(2);
    const { index, entries } = result.current;

    expect(await result.current.refresh(entries[0].source)).toBe(true);
    expect(await result.current.setScopes(entries[1].source, [])).toBe(true);
    await expect.poll(() => result.current.entries).not.toBe(entries);
    expect(result.current.entries[0].loaded).toBe(entries[0].loaded);
    expect(result.current.index).toBe(index);

    expect(await result.current.toggle(entries[1].source)).toBe(true);
    await expect.poll(() => result.current.index.schemas.map((s) => s.id)).toEqual(["a"]);
  });

  it("refreshes URL sources concurrently when opened", async () => {
    const bytes = await loadDescriptor(descriptorUrl);
    const { backend: fake } = fakeSchemaBackend({ sources: await urlSources() });
    const pending: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const backend: SchemaBackend = {
      ...fake,
      async fetchDescriptor(url) {
        pending.push(url);
        await gate;
        return bytes;
      },
    };
    const { result } = await renderHook(() => useSchemas(backend));

    await expect.poll(() => pending.toSorted()).toEqual([URL_A, URL_B]);
    release();
    await expect.poll(() => result.current.index.schemas.length).toBe(2);
    expect(result.current.error).toBeUndefined();
  });
});
