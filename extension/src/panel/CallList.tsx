import { useEffect, useRef, type KeyboardEvent } from "react";
import { t } from "../i18n";
import type { CallRow } from "./useDecodedRows";

export function CallList({
  rows,
  selectedId,
  onSelect,
  empty,
}: {
  rows: CallRow[];
  selectedId?: number;
  onSelect: (id: number) => void;
  /** True when nothing has been recorded at all (as opposed to everything being filtered out). */
  empty: boolean;
}) {
  const compact = selectedId !== undefined;
  // Arrow keys, Home, and End move the selection, as in the Network panel.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = rows.length - 1;
    const i = rows.findIndex((r) => r.raw.id === selectedId);
    const next = {
      ArrowDown: i < 0 ? 0 : Math.min(i + 1, last),
      ArrowUp: i < 0 ? last : Math.max(i - 1, 0),
      Home: 0,
      End: last,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    if (rows[next]) onSelect(rows[next].raw.id);
  };
  return (
    <div className="list" tabIndex={0} aria-label={t("list.label")} onKeyDown={onKeyDown}>
      <table>
        <thead>
          <tr>
            <th>{t("list.name")}</th>
            {!compact && (
              <>
                <th>{t("list.protocol")}</th>
                <th>{t("list.status")}</th>
                <th>{t("list.messages")}</th>
                <th>{t("list.time")}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <ListRow
              key={r.raw.id}
              row={r}
              compact={compact}
              selected={r.raw.id === selectedId}
              onSelect={() => onSelect(r.raw.id)}
            />
          ))}
        </tbody>
      </table>
      {empty && (
        <div className="empty">
          <p>{t("list.empty")}</p>
          <p>{t("list.emptyHint")}</p>
        </div>
      )}
    </div>
  );
}

function ListRow({
  row,
  compact,
  selected,
  onSelect,
}: {
  row: CallRow;
  compact: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { call, raw } = row;
  const failed = !call || call.status.code !== 0;
  const ref = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <tr
      ref={ref}
      className={`${selected ? "selected" : ""} ${failed ? "failed" : ""}`}
      data-method={call?.method}
      data-transport={call?.transport}
      data-codec={call?.codec}
      aria-selected={selected}
      onClick={onSelect}
    >
      <td title={call?.path ?? raw.url}>
        <span className="method">{call?.method ?? "?"}</span>
        <span className="service">{call?.service}</span>
        {call && !call.schemaFound && call.codec === "proto" && (
          <span className="badge warn" title={t("list.noSchemaTitle")}>
            {t("list.noSchema")}
          </span>
        )}
      </td>
      {!compact && (
        <>
          <td>{call ? `${call.transport}${call.codec === "json" ? " (json)" : ""}` : "-"}</td>
          <td>{call ? `${call.status.code} ${call.status.name}` : t("list.decodeError")}</td>
          <td>{call ? `${call.requestMessages.length} / ${call.responseMessages.length}` : "-"}</td>
          <td>{Math.round(raw.time)} ms</td>
        </>
      )}
    </tr>
  );
}
