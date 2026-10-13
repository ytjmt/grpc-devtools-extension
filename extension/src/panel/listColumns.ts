import type { RawCall } from "../core/types";
import { t, type MessageKey } from "../i18n";
import type { CallRow } from "./useDecodedRows";

/** A call-list column: its header, cell text, and sort value. */
export interface Column {
  key: SortKey;
  label: MessageKey;
  text: (row: CallRow) => string;
  /** Rows without a value (undecodable calls) sort last in either direction. */
  value: (row: CallRow) => string | number | undefined;
}

export type SortKey = "name" | "protocol" | "status" | "messages" | "size" | "time" | "started";

export interface Sort {
  key: SortKey;
  descending: boolean;
}

export const NAME_COLUMN: Column = {
  key: "name",
  label: "list.name",
  text: (r) => r.call?.path ?? r.raw.url,
  // Rows show the method first, so sort by it.
  value: (r) => r.call && `${r.call.method}\0${r.call.service}`,
};

export const COLUMNS: Column[] = [
  {
    key: "protocol",
    label: "list.protocol",
    text: (r) => (r.call ? `${r.call.transport}${r.call.codec === "json" ? " (json)" : ""}` : "-"),
    value: (r) => r.call && `${r.call.transport} ${r.call.codec}`,
  },
  {
    key: "status",
    label: "list.status",
    text: (r) => (r.call ? `${r.call.status.code} ${r.call.status.name}` : t("list.decodeError")),
    value: (r) => r.call?.status.code,
  },
  {
    key: "messages",
    label: "list.messages",
    text: (r) => (r.call ? `${r.call.requestMessages.length} / ${r.call.responseMessages.length}` : "-"),
    value: (r) => r.call && r.call.requestMessages.length + r.call.responseMessages.length,
  },
  {
    key: "size",
    label: "list.size",
    text: (r) => formatSize(responseSize(r.raw)),
    value: (r) => responseSize(r.raw),
  },
  {
    key: "time",
    label: "list.time",
    text: (r) => `${Math.round(r.raw.time)} ms`,
    value: (r) => r.raw.time,
  },
  {
    key: "started",
    label: "list.started",
    text: (r) => formatClock(r.raw.startedDateTime),
    value: (r) => Date.parse(r.raw.startedDateTime) || undefined,
  },
];

/** Sorts rows by a column; ties keep their recorded (start) order. */
export function sortRows(rows: CallRow[], sort: Sort | undefined): CallRow[] {
  if (!sort) return rows;
  const column = [NAME_COLUMN, ...COLUMNS].find((c) => c.key === sort.key)!;
  const sign = sort.descending ? -1 : 1;
  return rows
    .map((row) => ({ row, value: column.value(row) }))
    .sort((a, b) => {
      if (a.value === undefined || b.value === undefined)
        return a.value === b.value ? 0 : a.value === undefined ? 1 : -1;
      return sign * (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);
    })
    .map(({ row }) => row);
}

/** Bytes of the response body as received (before any RPC-level decompression). */
export function responseSize(raw: RawCall): number {
  const { content, encoding } = raw.responseBody;
  if (!content) return 0;
  if (encoding !== "base64") return new TextEncoder().encode(content).length;
  const b64 = content.replace(/\s+/g, "");
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
}

/** Like the Network panel: B, then kB and MB in powers of 1000. */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1000 / 1000).toFixed(1)} MB`;
}

/** Local time of day with milliseconds, e.g. 14:03:07.215. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
