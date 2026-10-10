import { useMemo, useState, useSyncExternalStore } from "react";
import type { CaptureStore } from "../capture";
import { t } from "../i18n";
import { CallDetail } from "./CallDetail";
import { CallList } from "./CallList";
import type { SchemaBackend } from "./schemaBackend";
import { SchemasView } from "./SchemasView";
import { useDecodedRows } from "./useDecodedRows";
import { useSchemas } from "./useSchemas";

export function App({ store, schemaBackend }: { store: CaptureStore; schemaBackend: SchemaBackend }) {
  const calls = useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.calls,
  );
  const preserveLog = useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.preserveLog,
  );
  const schemas = useSchemas(schemaBackend);
  const rows = useDecodedRows(calls, schemas.index);
  const [selectedId, setSelectedId] = useState<number>();
  const [filter, setFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [view, setView] = useState<"calls" | "schemas">("calls");

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (errorsOnly && (r.call?.status.code ?? 2) === 0) return false;
      return !q || (r.call?.path ?? r.raw.url).toLowerCase().includes(q);
    });
  }, [rows, filter, errorsOnly]);
  const selected = rows.find((r) => r.raw.id === selectedId);
  const enabledSchemas = schemas.entries.filter((e) => e.source.enabled && e.loaded).length;

  return (
    <div className="app">
      <div className="toolbar">
        <button title={t("toolbar.clear")} aria-label={t("toolbar.clear")} onClick={() => (store.clear(), setSelectedId(undefined))}>
          ⊘
        </button>
        <input
          className="filter"
          placeholder={t("toolbar.filter")}
          aria-label={t("toolbar.filter")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label>
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
          {t("toolbar.errorsOnly")}
        </label>
        <label>
          <input type="checkbox" checked={preserveLog} onChange={(e) => store.setPreserveLog(e.target.checked)} />
          {t("toolbar.preserveLog")}
        </label>
        <span className="spacer" />
        <button
          className={view === "schemas" ? "active" : ""}
          onClick={() => setView(view === "schemas" ? "calls" : "schemas")}
        >
          {t("toolbar.schemas", { count: enabledSchemas })}
        </button>
      </div>

      {view === "schemas" ? (
        <SchemasView schemas={schemas} />
      ) : (
        <div className={`main ${selected ? "with-detail" : ""}`}>
          <CallList
            rows={visible}
            selectedId={selected?.raw.id}
            onSelect={setSelectedId}
            empty={rows.length === 0}
          />
          {selected && (
            <CallDetail row={selected} onClose={() => setSelectedId(undefined)} onOpenSchemas={() => setView("schemas")} />
          )}
        </div>
      )}
      <div className="statusbar">
        {t("status.count", { visible: visible.length, total: rows.length })}
        {/* The schemas view shows its own error box. */}
        {schemas.error && view !== "schemas" && <span className="error"> · {schemas.error}</span>}
      </div>
    </div>
  );
}
