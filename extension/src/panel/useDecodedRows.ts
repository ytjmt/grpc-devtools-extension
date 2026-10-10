import { useMemo, useRef } from "react";
import { decodeCall } from "../core/decode";
import type { SchemaIndex } from "../core/schema";
import type { DecodedCall, RawCall } from "../core/types";
import { errorText } from "../i18n";

export type CallRow = { raw: RawCall; call?: DecodedCall; error?: string };

export function decodeRow(raw: RawCall, index: SchemaIndex): CallRow {
  try {
    return { raw, call: decodeCall(raw, index) };
  } catch (e) {
    return { raw, error: errorText(e) };
  }
}

/** Decodes each call once per schema index; re-decodes everything when schemas change. */
export function useDecodedRows(calls: RawCall[], index: SchemaIndex): CallRow[] {
  const cache = useRef<{ index: SchemaIndex; rows: Map<number, CallRow> }>({ index, rows: new Map() });
  return useMemo(() => {
    if (cache.current.index !== index) cache.current = { index, rows: new Map() };
    const { rows } = cache.current;
    return calls.map((raw) => {
      let row = rows.get(raw.id);
      if (!row) {
        row = decodeRow(raw, index);
        rows.set(raw.id, row);
      }
      return row;
    });
  }, [calls, index]);
}
