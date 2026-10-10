import { useState } from "react";

/** Collapsible JSON viewer in the style of the DevTools preview pane. */
export function JsonTree({
  value,
  name,
  depth = 0,
  level = 0,
  path = [],
  describe,
}: {
  value: unknown;
  name?: string;
  /** Indentation depth. */
  depth?: number;
  /**
   * Nesting that counts toward auto-expansion. Single-key wrappers such as
   * `{ product: {...} }` (common response style) do not add a level.
   */
  level?: number;
  /** Keys from the root to this value. */
  path?: string[];
  /** Tooltip for a key, e.g. the schema field it maps to. */
  describe?: (path: string[]) => string | undefined;
}) {
  const [open, setOpen] = useState(level < 2);
  const info = name !== undefined ? describe?.(path) : undefined;
  const label =
    name !== undefined ? (
      <span className={`jt-key ${info ? "has-info" : ""}`} title={info}>
        {name}:{" "}
      </span>
    ) : null;

  if (value === null || typeof value !== "object") {
    return (
      <div className="jt-row" style={{ paddingLeft: depth * 14 + 12 }}>
        {label}
        <Primitive value={value} />
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  const summary = isArray ? `Array(${entries.length})` : entries.length ? "{…}" : "{}";

  return (
    <>
      <div className="jt-row jt-toggle" style={{ paddingLeft: depth * 14 }} onClick={() => setOpen(!open)}>
        <span className="jt-arrow">{entries.length ? (open ? "▾" : "▸") : " "}</span>
        {label}
        <span className="jt-summary">{summary}</span>
      </div>
      {open &&
        entries.map(([k, v]) => (
          <JsonTree
            key={k}
            name={k}
            value={v}
            depth={depth + 1}
            level={entries.length === 1 ? level : level + 1}
            path={[...path, k]}
            describe={describe}
          />
        ))}
    </>
  );
}

function Primitive({ value }: { value: unknown }) {
  if (typeof value === "string") return <span className="jt-string">"{value}"</span>;
  if (typeof value === "number" || typeof value === "bigint") return <span className="jt-number">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="jt-bool">{String(value)}</span>;
  return <span className="jt-null">{String(value)}</span>;
}
