import { describe, expect, it } from "vite-plus/test";
import { renderHook } from "vitest-browser-react";
import { isCompressed } from "../../extension/src/core/compression";
import { SchemaIndex } from "../../extension/src/core/schema";
import type { RawCall } from "../../extension/src/core/types";
import { useDecodedRows } from "../../extension/src/panel/useDecodedRows";
import { compressionCalls, demoCalls } from "../fixtures/builders";

const index = SchemaIndex.empty;
const compressed = compressionCalls.find(isCompressed)!;
const decompressed = (calls: RawCall[], rows: ReturnType<typeof useDecodedRows>) =>
  rows.length === calls.length && rows.every((r) => r.call?.responseMessages.every((m) => m.error === undefined));

describe("useDecodedRows", () => {
  it("reuses rows of calls that are still recorded", async () => {
    const [a, b] = demoCalls;
    const { result, rerender } = await renderHook((calls: RawCall[] = []) => useDecodedRows(calls, index), {
      initialProps: [a, b],
    });
    const rowB = result.current[1];
    await rerender([b]);
    expect(result.current).toEqual([rowB]);
    expect(result.current[0]).toBe(rowB);
  });

  it("forgets cleared calls, including their decompressed bodies", async () => {
    const { result, rerender } = await renderHook((calls: RawCall[] = []) => useDecodedRows(calls, index), {
      initialProps: [compressed],
    });
    await expect.poll(() => decompressed([compressed], result.current)).toBe(true);
    const before = result.current[0];

    await rerender([]);
    expect(result.current).toEqual([]);

    // Same id again (as after a clear): decoded afresh and decompressed again, not served from a stale cache.
    await rerender([compressed]);
    expect(result.current[0]).not.toBe(before);
    await expect.poll(() => decompressed([compressed], result.current)).toBe(true);
  });
});
