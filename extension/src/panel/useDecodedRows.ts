import { useEffect, useMemo, useRef, useState } from "react";
import { extractBodies, hasCompression, type Bodies } from "../core/bodies";
import { decompressBodies } from "../core/compression";
import { decodeCall } from "../core/decode";
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

function tryExtract(raw: RawCall): Bodies | undefined {
  try {
    return extractBodies(raw);
  } catch {
    return undefined; // decodeRow extracts again and reports why
  }
}

/** Captured bodies per call id, extracted once rather than on every re-decode. */
function useExtractedBodies(calls: RawCall[]): Map<number, Bodies | undefined> {
  const cache = useRef(new Map<number, Bodies | undefined>());
  return useMemo(() => {
    // Rebuilt from `calls` each time, so cleared or capped calls are not kept alive.
    const next = new Map<number, Bodies | undefined>();
    for (const raw of calls) {
      next.set(raw.id, cache.current.has(raw.id) ? cache.current.get(raw.id) : tryExtract(raw));
    }
    cache.current = next;
    return next;
  }, [calls]);
}

/**
 * Decompresses calls that use RPC-level compression. Decompression is async
 * (DecompressionStream), so such rows first decode as "compressed" and update
 * once their bodies are ready.
 */
function useDecompressedBodies(calls: RawCall[], extracted: Map<number, Bodies | undefined>): Map<number, Bodies> {
  const [bodies, setBodies] = useState(() => new Map<number, Bodies>());
  const started = useRef(new Set<number>());
  useEffect(() => {
    // Forget calls that were cleared or dropped by the log cap.
    for (const id of started.current) if (!extracted.has(id)) started.current.delete(id);
    setBodies((prev) => {
      const kept = new Map([...prev].filter(([id]) => extracted.has(id)));
      return kept.size === prev.size ? prev : kept;
    });

    for (const raw of calls) {
      if (started.current.has(raw.id)) continue;
      started.current.add(raw.id);
      const captured = extracted.get(raw.id);
      if (!captured || !hasCompression(captured)) continue;
      decompressBodies(raw, captured).then(
        // Skip calls removed while decompressing.
        (b) => started.current.has(raw.id) && setBodies((prev) => new Map(prev).set(raw.id, b)),
        () => {}, // leave it compressed; decodeCall reports why
      );
    }
  }, [calls, extracted]);
  return bodies;
}

/** Decodes each call once per schema index; re-decodes everything when schemas change. */
export function useDecodedRows(calls: RawCall[], index: SchemaIndex): CallRow[] {
  const extracted = useExtractedBodies(calls);
  const decompressed = useDecompressedBodies(calls, extracted);
  const cache = useRef<{ index: SchemaIndex; rows: Map<number, { row: CallRow; bodies?: Bodies }> }>({
    index,
    rows: new Map(),
  });
  return useMemo(() => {
    const prev = cache.current.index === index ? cache.current.rows : new Map<number, never>();
    const rows = new Map<number, { row: CallRow; bodies?: Bodies }>();
    const result = calls.map((raw) => {
      const ready = decompressed.get(raw.id) ?? extracted.get(raw.id);
      let entry = prev.get(raw.id);
      // Re-decode when decompressed bodies arrive.
      if (!entry || entry.bodies !== ready) entry = { row: decodeRow(raw, index, ready), bodies: ready };
      rows.set(raw.id, entry);
      return entry.row;
    });
    cache.current = { index, rows };
    return result;
  }, [calls, index, extracted, decompressed]);
}
