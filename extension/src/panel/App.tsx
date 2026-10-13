import { useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { CaptureStore } from "../capture";
import { t } from "../i18n";
import type { SchemaRef } from "../core/curl";
import { CallDetail } from "./CallDetail";
import { collectMethodStats } from "./methodStats";
import { SchemaBrowser, type BrowseSchema, type BrowseSelection } from "./SchemaBrowser";
import { CallList } from "./CallList";
import type { SchemaBackend } from "./schemaBackend";
import { SchemasView } from "./SchemasView";
import { Splitter, useListWidth } from "./Splitter";
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
  /** Exact RPC path from "Show recorded calls" in the schema browser. */
  const [methodFilter, setMethodFilter] = useState<string>();
  const [view, setView] = useState<"calls" | "schemas">("calls");
  const [schemasTab, setSchemasTab] = useState<"browse" | "manage">("browse");
  const [browseSelection, setBrowseSelection] = useState<BrowseSelection>();
  const listWidth = useListWidth();
  const openSchemas = (tab: "browse" | "manage", selection?: BrowseSelection) => {
    setView("schemas");
    setSchemasTab(tab);
    if (selection) setBrowseSelection(selection);
  };
  const browseSchemas = useMemo<BrowseSchema[]>(
    () =>
      schemas.entries.flatMap(({ source, loaded }) =>
        source.enabled && loaded ? [{ id: source.id, name: source.name, registry: loaded.registry }] : [],
      ),
    [schemas.entries],
  );

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (errorsOnly && (r.call?.status.code ?? 2) === 0) return false;
      if (methodFilter && r.call?.path !== methodFilter) return false;
      return !q || (r.call?.path ?? r.raw.url).toLowerCase().includes(q);
    });
  }, [rows, filter, errorsOnly, methodFilter]);
  const methodStats = useMemo(() => collectMethodStats(rows), [rows]);
  const showCalls = (path: string) => {
    setMethodFilter(path);
    setSelectedId(undefined);
    setView("calls");
  };
  const selected = rows.find((r) => r.raw.id === selectedId);
  const schemaRefOf = (id: string | undefined): SchemaRef | undefined => {
    const source = schemas.entries.find((e) => e.source.id === id)?.source;
    return source && { kind: source.kind, name: source.name, url: source.url };
  };
  const enabledSchemas = schemas.entries.filter((e) => e.source.enabled && e.loaded).length;

  return (
    <div className="app">
      <div className="toolbar">
        <button
          className="icon-button"
          title={t("toolbar.clear")}
          aria-label={t("toolbar.clear")}
          onClick={() => (store.clear(), setSelectedId(undefined))}
        >
          {/* The "block" glyph DevTools uses for Clear network log. */}
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <circle cx="10" cy="10" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5.25 5.25l9.5 9.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <input
          className="filter"
          placeholder={t("toolbar.filter")}
          aria-label={t("toolbar.filter")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {methodFilter && (
          <span className="chip" role="status">
            {t("toolbar.methodFilter", { method: methodFilter })}
            <button
              aria-label={t("toolbar.clearMethodFilter")}
              title={t("toolbar.clearMethodFilter")}
              onClick={() => setMethodFilter(undefined)}
            >
              ✕
            </button>
          </span>
        )}
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
          onClick={() =>
            view === "schemas" ? setView("calls") : openSchemas(browseSchemas.length ? "browse" : "manage")
          }
        >
          {t("toolbar.schemas", { count: enabledSchemas })}
        </button>
      </div>

      {view === "schemas" ? (
        <div className="schemas-view">
          <div className="tabs" role="tablist">
            {(["browse", "manage"] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={schemasTab === tab}
                className={schemasTab === tab ? "active" : ""}
                onClick={() => setSchemasTab(tab)}
              >
                {t(`schemas.tab.${tab}`)}
              </button>
            ))}
          </div>
          {schemasTab === "browse" ? (
            <SchemaBrowser
              schemas={browseSchemas}
              selection={browseSelection}
              onSelect={setBrowseSelection}
              calls={{ stats: methodStats, onShowCalls: showCalls }}
            />
          ) : (
            <SchemasView schemas={schemas} />
          )}
        </div>
      ) : (
        <div
          className={`main ${selected ? "with-detail" : ""}`}
          style={listWidth.width ? ({ "--list-width": `${listWidth.width}px` } as CSSProperties) : undefined}
        >
          <CallList rows={visible} selectedId={selected?.raw.id} onSelect={setSelectedId} empty={rows.length === 0} />
          {selected && <Splitter onResize={listWidth.setWidth} onCommit={listWidth.save} />}
          {selected && (
            <CallDetail
              row={selected}
              schemaRef={schemaRefOf(selected.call?.schemaId)}
              onClose={() => setSelectedId(undefined)}
              onOpenSchemas={() => openSchemas("manage")}
              onOpenType={
                selected.call?.schemaId
                  ? (typeName) => openSchemas("browse", { schemaId: selected.call!.schemaId!, typeName })
                  : undefined
              }
            />
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
