import { useState } from "react";
import type { TreeNode } from "../core/schemaTree";
import { methodKey, type MethodStats } from "./methodStats";
import type { BrowseSelection } from "./SchemaBrowser";

export function TreeItem({
  node,
  depth,
  schemaId,
  forceOpen,
  selection,
  onSelect,
  stats,
}: {
  node: TreeNode;
  depth: number;
  schemaId: string;
  forceOpen: boolean;
  selection?: BrowseSelection;
  onSelect: (s: BrowseSelection) => void;
  stats?: Map<string, MethodStats>;
}) {
  const methodStats =
    node.kind === "method" ? stats?.get(methodKey(schemaId, `/${node.typeName}/${node.member}`)) : undefined;
  // Packages (except well-known types) and services start open, so methods are visible at once.
  const [open, setOpen] = useState(
    (node.kind === "package" && !node.label.startsWith("google.")) || node.kind === "service",
  );
  const expanded = forceOpen || open;
  const selected =
    selection?.schemaId === schemaId &&
    selection.typeName === node.typeName &&
    (node.kind === "method" ? selection.member === node.member : node.kind !== "service" || !selection.member);

  return (
    <>
      <div
        role="treeitem"
        aria-label={node.label}
        aria-selected={selected}
        aria-expanded={node.children.length ? expanded : undefined}
        className={`tree-row kind-${node.kind} ${selected ? "selected" : ""}`}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => {
          if (node.typeName) onSelect({ schemaId, typeName: node.typeName, member: node.member });
          else setOpen(!open);
        }}
      >
        <span
          className="jt-arrow"
          aria-hidden
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!expanded);
          }}
        >
          {node.children.length ? (expanded ? "▾" : "▸") : " "}
        </span>
        <span className="tree-kind" aria-hidden>
          {kindIcon(node.kind)}
        </span>
        <span className="tree-label">{node.label}</span>
        {node.hint && <span className="tree-hint">· {node.hint}</span>}
        {methodStats && (
          <span className={`tree-count ${methodStats.last.code === 0 ? "" : "failed"}`} aria-hidden>
            {methodStats.count}
          </span>
        )}
      </div>
      {expanded &&
        node.children.map((c) => (
          <TreeItem
            key={c.key}
            node={c}
            depth={depth + 1}
            schemaId={schemaId}
            forceOpen={forceOpen}
            selection={selection}
            onSelect={onSelect}
            stats={stats}
          />
        ))}
    </>
  );
}

function kindIcon(kind: TreeNode["kind"]): string {
  return { package: "📦", service: "S", method: "ƒ", message: "M", enum: "E" }[kind];
}
