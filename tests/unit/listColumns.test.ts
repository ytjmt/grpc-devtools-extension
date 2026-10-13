import { describe, expect, it } from "vite-plus/test";
import { SchemaIndex } from "../../extension/src/core/schema";
import { formatClock, formatSize, responseSize, sortRows } from "../../extension/src/panel/listColumns";
import { decodeRow } from "../../extension/src/panel/useDecodedRows";
import { demoCalls } from "../fixtures/builders";

describe("responseSize", () => {
  const raw = (content: string | null, encoding: string) => ({ ...demoCalls[0], responseBody: { content, encoding } });

  it("counts decoded bytes of base64 bodies, including padding", () => {
    expect(responseSize(raw("AAAA", "base64"))).toBe(3);
    expect(responseSize(raw("AAA=", "base64"))).toBe(2);
    expect(responseSize(raw("AA==\n", "base64"))).toBe(1);
  });

  it("counts UTF-8 bytes of text bodies, and 0 without a body", () => {
    expect(responseSize(raw('{"a":"é"}', ""))).toBe(10);
    expect(responseSize(raw(null, ""))).toBe(0);
  });
});

describe("formatting", () => {
  it("formats sizes like the Network panel", () => {
    expect(formatSize(999)).toBe("999 B");
    expect(formatSize(1500)).toBe("1.5 kB");
    expect(formatSize(2_340_000)).toBe("2.3 MB");
  });

  it("formats start times as local time of day, and '-' when missing", () => {
    const d = new Date(2026, 0, 1, 9, 5, 7, 42);
    expect(formatClock(d.toISOString())).toBe("09:05:07.042");
    expect(formatClock("")).toBe("-");
  });
});

describe("sortRows", () => {
  const rows = demoCalls.map((c) => decodeRow(c, SchemaIndex.empty));
  const broken = decodeRow({ ...demoCalls[0], id: 99, requestHeaders: [], url: "http://x/a.B/C" }, SchemaIndex.empty);

  it("keeps the recorded order without a sort", () => {
    expect(sortRows(rows, undefined)).toBe(rows);
  });

  it("puts rows without a value last in both directions", () => {
    const all = [broken, ...rows];
    expect(broken.call).toBeUndefined();
    expect(sortRows(all, { key: "status", descending: false }).at(-1)).toBe(broken);
    expect(sortRows(all, { key: "status", descending: true }).at(-1)).toBe(broken);
  });

  it("keeps recorded order between equal values", () => {
    const sorted = sortRows(rows, { key: "status", descending: false });
    expect(sorted.map((r) => r.raw.id)).toEqual(
      rows
        .filter((r) => r.call?.status.code === 0)
        .map((r) => r.raw.id)
        .concat(rows[3].raw.id),
    );
  });
});
