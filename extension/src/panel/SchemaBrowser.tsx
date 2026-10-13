import type { FileRegistry } from "@bufbuild/protobuf";
import { useMemo, useState, type CSSProperties } from "react";
import { buildTree, filterTree, type TreeNode } from "../core/schemaTree";
import { t } from "../i18n";
import type { MethodStats } from "./methodStats";
import { Splitter, usePaneWidth } from "./Splitter";
import { TreeItem } from "./TypeTree";
import { TypeDetail, type DetailView } from "./TypeDetail";

export interface BrowseSchema {
  id: string;
  name: string;
  registry: FileRegistry;
}

export interface BrowseSelection {
  schemaId: string;
  typeName: string;
  /** A method of the selected service, to highlight. */
  member?: string;
}

/** Recorded-call statistics for methods, and a way to jump to those calls. */
export interface CallLinks {
  stats: Map<string, MethodStats>;
  onShowCalls: (path: string) => void;
}

/** Match the min-width / max-width rules on `.browser-nav` in styles.css. */
const NAV_MIN_WIDTH = 180;
const DETAIL_MIN_WIDTH = 240;

export function SchemaBrowser({
  schemas,
  selection,
  onSelect,
  calls,
}: {
  schemas: BrowseSchema[];
  selection?: BrowseSelection;
  onSelect: (selection: BrowseSelection) => void;
  calls?: CallLinks;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<DetailView>("table");
  const navWidth = usePaneWidth("grpc-devtools.schemaNavWidth");
  const trees = useMemo(() => schemas.map((s) => ({ schema: s, nodes: buildTree(s.registry) })), [schemas]);
  const filtered = useMemo(
    () =>
      trees
        .map(({ schema, nodes }) => ({ schema, nodes: filterTree(nodes, query, schema.registry) }))
        .filter((t) => t.nodes.length),
    [trees, query],
  );

  // Default to the first service so the view is never empty.
  const current = selection ?? firstService(trees);
  const selectedSchema = schemas.find((s) => s.id === current?.schemaId);

  if (schemas.length === 0) return <div className="empty">{t("browse.noSchemas")}</div>;

  return (
    <div
      className="browser"
      style={navWidth.width ? ({ "--nav-width": `${navWidth.width}px` } as CSSProperties) : undefined}
    >
      <div className="browser-nav">
        <input
          className="filter"
          type="search"
          placeholder={t("browse.search")}
          aria-label={t("browse.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="tree" role="tree" aria-label={t("browse.tree")}>
          {filtered.map(({ schema, nodes }) => (
            <div key={schema.id} role="group" aria-label={schema.name}>
              {schemas.length > 1 && <div className="tree-schema">{schema.name}</div>}
              {nodes.map((n) => (
                <TreeItem
                  key={n.key}
                  node={n}
                  depth={0}
                  schemaId={schema.id}
                  forceOpen={query.trim() !== ""}
                  selection={current}
                  onSelect={onSelect}
                  stats={calls?.stats}
                />
              ))}
            </div>
          ))}
          {filtered.length === 0 && <div className="empty">{t("browse.noMatches")}</div>}
        </div>
      </div>
      <Splitter
        label={t("browse.resize")}
        min={NAV_MIN_WIDTH}
        restMin={DETAIL_MIN_WIDTH}
        onResize={navWidth.setWidth}
        onCommit={navWidth.save}
      />
      <div className="browser-detail">
        {current && selectedSchema ? (
          <TypeDetail
            schema={selectedSchema}
            selection={current}
            onSelect={onSelect}
            calls={calls}
            view={view}
            onViewChange={setView}
          />
        ) : (
          <div className="empty">{t("browse.selectType")}</div>
        )}
      </div>
    </div>
  );
}

/** The first service in any package (packages like common.v1 may hold only messages), else the first type. */
function firstService(trees: { schema: BrowseSchema; nodes: TreeNode[] }[]): BrowseSelection | undefined {
  const all = trees.flatMap(({ schema, nodes }) =>
    nodes.flatMap((pkg) => pkg.children.map((node) => ({ schema, node }))),
  );
  const pick = all.find(({ node }) => node.kind === "service") ?? all.find(({ node }) => node.typeName);
  return pick && { schemaId: pick.schema.id, typeName: pick.node.typeName! };
}
