import { useEffect, useMemo, useRef, useState } from "react";
import { decompressBodies, isCompressed } from "../core/compression";
import { decodeCall, type Bodies } from "../core/decode";
import type { SchemaIndex } from "../core/schema";
import type { DecodedCall, RawCall } from "../core/types";
import { errorText } from "../i18n";

export type CallRow = { raw: RawCall; call?: DecodedCall; error?: string };

export function decodeRow(raw: RawCall, index: SchemaIndex, bodies?: Bodies): CallRow {
  try {
    return { raw, call: decodeCall(raw, index, bodies) };
  } catch (e) {
    return { raw, error: errorText(e) };
  }
}

/**
 * Decompresses calls that use RPC-level compression. Decompression is async
 * (DecompressionStream), so such rows first decode as "compressed" and update
 * once their bodies are ready.
 */
function useDecompressedBodies(calls: RawCall[]): Map<number, Bodies> {
  const [bodies, setBodies] = useState(() => new Map<number, Bodies>());
  const started = useRef(new Set<number>());
  useEffect(() => {
    for (const raw of calls) {
      if (started.current.has(raw.id)) continue;
      started.current.add(raw.id);
      if (!isCompressed(raw)) continue;
      decompressBodies(raw).then(
        (b) => setBodies((prev) => new Map(prev).set(raw.id, b)),
        () => {}, // leave it compressed; decodeCall reports why
      );
    }
  }, [calls]);
  return bodies;
}

/** Decodes each call once per schema index; re-decodes everything when schemas change. */
export function useDecodedRows(calls: RawCall[], index: SchemaIndex): CallRow[] {
  const bodies = useDecompressedBodies(calls);
  const cache = useRef<{ index: SchemaIndex; rows: Map<number, { row: CallRow; bodies?: Bodies }> }>({
    index,
    rows: new Map(),
  });
  return useMemo(() => {
    if (cache.current.index !== index) cache.current = { index, rows: new Map() };
    const { rows } = cache.current;
    return calls.map((raw) => {
      const ready = bodies.get(raw.id);
      let entry = rows.get(raw.id);
      // Re-decode when decompressed bodies arrive.
      if (!entry || entry.bodies !== ready) {
        entry = { row: decodeRow(raw, index, ready), bodies: ready };
        rows.set(raw.id, entry);
      }
      return entry.row;
    });
  }, [calls, index, bodies]);
}
