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
    // Forget calls that were cleared or dropped by the log cap.
    const live = new Set(calls.map((raw) => raw.id));
    for (const id of started.current) if (!live.has(id)) started.current.delete(id);
    setBodies((prev) => {
      const kept = new Map([...prev].filter(([id]) => live.has(id)));
      return kept.size === prev.size ? prev : kept;
    });

    for (const raw of calls) {
      if (started.current.has(raw.id)) continue;
      started.current.add(raw.id);
      if (!isCompressed(raw)) continue;
      decompressBodies(raw).then(
        // Skip calls removed while decompressing.
        (b) => started.current.has(raw.id) && setBodies((prev) => new Map(prev).set(raw.id, b)),
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
    const prev = cache.current.index === index ? cache.current.rows : new Map<number, never>();
    // Rebuilt from `calls` each time, so cleared or capped calls are not kept alive.
    const rows = new Map<number, { row: CallRow; bodies?: Bodies }>();
    const result = calls.map((raw) => {
      const ready = bodies.get(raw.id);
      let entry = prev.get(raw.id);
      // Re-decode when decompressed bodies arrive.
      if (!entry || entry.bodies !== ready) entry = { row: decodeRow(raw, index, ready), bodies: ready };
      rows.set(raw.id, entry);
      return entry.row;
    });
    cache.current = { index, rows };
    return result;
  }, [calls, index, bodies]);
}
