import type { CallStatus } from "../core/types";
import type { CallRow } from "./useDecodedRows";

export interface MethodStats {
  count: number;
  /** Status of the most recent call. */
  last: CallStatus;
}

/** Key for a method as decoded by a given schema. */
export const methodKey = (schemaId: string, path: string) => `${schemaId}|${path}`;

/**
 * Recorded calls per method, counting each call only under the schema that
 * actually decoded it (so duplicate definitions in other schemas get none).
 */
export function collectMethodStats(rows: CallRow[]): Map<string, MethodStats> {
  const stats = new Map<string, MethodStats>();
  for (const { call } of rows) {
    if (!call?.schemaId) continue;
    const key = methodKey(call.schemaId, call.path);
    const prev = stats.get(key);
    // Rows are in start order, so the last one seen started most recently.
    stats.set(key, { count: (prev?.count ?? 0) + 1, last: call.status });
  }
  return stats;
}
