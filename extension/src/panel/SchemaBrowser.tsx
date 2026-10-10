import type { DescEnum, DescField, DescMessage, DescOneof, DescService, FileRegistry } from "@bufbuild/protobuf";
import { useEffect, useMemo, useRef, useState } from "react";
import { getComment } from "../core/comments";
import { fieldLabel, fieldTypeName, fieldTypeRef } from "../core/fields";
import { buildTree, buildUsages, filterTree, findType, type TreeNode, type UsageRef } from "../core/schemaTree";
import { t } from "../i18n";
import { methodKey, type MethodStats } from "./methodStats";

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
    <div className="browser">
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
      <div className="browser-detail">
        {current && selectedSchema ? (
          <TypeDetail schema={selectedSchema} selection={current} onSelect={onSelect} calls={calls} />
        ) : (
          <div className="empty">{t("browse.selectType")}</div>
        )}
      </div>
    </div>
  );
}

function firstService(trees: { schema: BrowseSchema; nodes: TreeNode[] }[]): BrowseSelection | undefined {
  for (const { schema, nodes } of trees) {
    for (const pkg of nodes) {
      const node = pkg.children.find((c) => c.kind === "service") ?? pkg.children[0];
      if (node?.typeName) return { schemaId: schema.id, typeName: node.typeName };
    }
  }
  return undefined;
}

function TreeItem({
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

function TypeDetail({
  schema,
  selection,
  onSelect,
  calls,
}: {
  schema: BrowseSchema;
  selection: BrowseSelection;
  onSelect: (s: BrowseSelection) => void;
  calls?: CallLinks;
}) {
  const desc = findType(schema.registry, selection.typeName);
  const usages = useMemo(() => buildUsages(schema.registry), [schema.registry]);
  const link = (typeName: string) => () => onSelect({ schemaId: schema.id, typeName });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [selection.typeName]);

  if (!desc) return <div className="empty">{t("browse.notFound", { type: selection.typeName })}</div>;
  return (
    <div ref={ref} className="type-detail">
      <div className="type-header">
        <span className="type-kind">{desc.kind === "service" ? "service" : desc.kind}</span>{" "}
        <h2>{desc.typeName}</h2>
        {desc.deprecated && <span className="badge warn">{t("browse.deprecated")}</span>}
        <span className="muted"> · {desc.file.proto.name}</span>
      </div>
      <Comment text={getComment(desc)} />
      {desc.kind === "service" && (
        <ServiceBody service={desc} member={selection.member} link={link} schemaId={schema.id} calls={calls} />
      )}
      {desc.kind === "message" && <MessageBody message={desc} link={link} />}
      {desc.kind === "enum" && <EnumBody en={desc} />}
      {desc.kind !== "service" && <Usages refs={usages.get(desc.typeName) ?? []} link={link} />}
    </div>
  );
}

function Comment({ text }: { text?: string }) {
  return text ? <p className="comment">{text}</p> : null;
}

function TypeLink({ typeName, link }: { typeName: string; link: (t: string) => () => void }) {
  return (
    <a
      href="#"
      className="type-link"
      onClick={(e) => {
        e.preventDefault();
        link(typeName)();
      }}
    >
      {typeName}
    </a>
  );
}

const METHOD_KINDS = {
  unary: "browse.unary",
  server_streaming: "browse.serverStreaming",
  client_streaming: "browse.clientStreaming",
  bidi_streaming: "browse.bidiStreaming",
} as const;

function ServiceBody({
  service,
  member,
  link,
  schemaId,
  calls,
}: {
  service: DescService;
  member?: string;
  link: (t: string) => () => void;
  schemaId: string;
  calls?: CallLinks;
}) {
  const highlighted = useRef<HTMLLIElement>(null);
  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: "nearest" });
  }, [member]);
  // One block per method rather than a wide table, so narrow DevTools panes need no horizontal scroll.
  return (
    <ul className="method-list">
      {service.methods.map((m) => (
        <li
          key={m.name}
          ref={m.name === member ? highlighted : undefined}
          className={`method-item ${m.name === member ? "highlight" : ""}`}
        >
          <div className="method-head">
            <span className={`method-name ${m.deprecated ? "deprecated" : ""}`}>{m.name}</span>
            <span className="method-kind">{t(METHOD_KINDS[m.methodKind])}</span>
            {calls && (
              <span className="method-calls">
                <CallsCell path={`/${service.typeName}/${m.name}`} schemaId={schemaId} calls={calls} />
              </span>
            )}
          </div>
          <div className="method-types">
            <span className="visually-hidden">{t("browse.request")}: </span>
            <TypeLink typeName={m.input.typeName} link={link} />
            <span className="muted" aria-hidden>
              {" "}
              →{" "}
            </span>
            <span className="visually-hidden">{t("browse.response")}: </span>
            <TypeLink typeName={m.output.typeName} link={link} />
          </div>
          <Comment text={getComment(m)} />
        </li>
      ))}
    </ul>
  );
}

function MessageBody({ message, link }: { message: DescMessage; link: (t: string) => () => void }) {
  const nested = [...message.nestedMessages, ...message.nestedEnums];
  return (
    <>
      {message.fields.length === 0 ? (
        <div className="empty">{t("browse.noFields")}</div>
      ) : (
        <table className="decl-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>{t("browse.field")}</th>
              <th>{t("browse.type")}</th>
              <th>{t("browse.description")}</th>
            </tr>
          </thead>
          <tbody>
            {message.members.map((m) =>
              m.kind === "oneof" ? (
                <OneofRows key={m.name} oneof={m} link={link} />
              ) : (
                <FieldRow key={m.name} field={m} link={link} />
              ),
            )}
          </tbody>
        </table>
      )}
      {nested.length > 0 && (
        <section className="decl-section">
          <h3>{t("browse.nestedTypes")}</h3>
          <ul>
            {nested.map((n) => (
              <li key={n.typeName}>
                <span className="muted">{n.kind}</span> <TypeLink typeName={n.typeName} link={link} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function OneofRows({ oneof, link }: { oneof: DescOneof; link: (t: string) => () => void }) {
  return (
    <>
      <tr className="oneof-row">
        <td />
        <td colSpan={2}>
          <span className="muted">oneof</span> {oneof.name}
        </td>
        <td>{getComment(oneof)}</td>
      </tr>
      {oneof.fields.map((f) => (
        <FieldRow key={f.name} field={f} link={link} inOneof />
      ))}
    </>
  );
}

function FieldRow({ field, link, inOneof }: { field: DescField; link: (t: string) => () => void; inOneof?: boolean }) {
  const ref = fieldTypeRef(field);
  const label = fieldLabel(field);
  const typeName = fieldTypeName(field);
  return (
    <tr className={inOneof ? "in-oneof" : ""}>
      <td className="num">{field.number}</td>
      <td>
        <span className={field.deprecated ? "deprecated" : ""}>{field.name}</span>
        {field.jsonName !== field.name && <span className="muted"> ({field.jsonName})</span>}
        {field.deprecated && <span className="badge warn">{t("browse.deprecated")}</span>}
      </td>
      <td className="mono">
        {label && <span className="muted">{label} </span>}
        {ref && field.fieldKind !== "map" ? (
          <TypeLink typeName={ref} link={link} />
        ) : ref ? (
          // map<k, V>: link only the value type.
          <>
            {typeName.slice(0, typeName.lastIndexOf(ref))}
            <TypeLink typeName={ref} link={link} />
            {">"}
          </>
        ) : (
          typeName
        )}
      </td>
      <td>{getComment(field)}</td>
    </tr>
  );
}

function EnumBody({ en }: { en: DescEnum }) {
  return (
    <table className="decl-table">
      <thead>
        <tr>
          <th className="num">#</th>
          <th>{t("browse.value")}</th>
          <th>{t("browse.description")}</th>
        </tr>
      </thead>
      <tbody>
        {en.values.map((v) => (
          <tr key={v.name}>
            <td className="num">{v.number}</td>
            <td className="mono">{v.name}</td>
            <td>{getComment(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Usages({ refs, link }: { refs: UsageRef[]; link: (t: string) => () => void }) {
  if (refs.length === 0) return null;
  return (
    <section className="decl-section">
      <h3>{t("browse.usedBy")}</h3>
      <ul>
        {refs.map((r) => (
          <li key={r.label}>
            <a
              href="#"
              className="type-link"
              onClick={(e) => {
                e.preventDefault();
                link(r.typeName)();
              }}
            >
              {r.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CallsCell({ path, schemaId, calls }: { path: string; schemaId: string; calls: CallLinks }) {
  const stats = calls.stats.get(methodKey(schemaId, path));
  if (!stats) return <span className="muted">{t("browse.noCalls")}</span>;
  const count = stats.count === 1 ? t("browse.callCountOne") : t("browse.callCountOther", { count: stats.count });
  return (
    <a
      href="#"
      className="type-link calls-link"
      title={t("browse.showCalls", { method: path })}
      onClick={(e) => {
        e.preventDefault();
        calls.onShowCalls(path);
      }}
    >
      <span className="nowrap">{count}</span>{" "}
      <span className={stats.last.code === 0 ? "muted" : "error-text"}>
        · {t("browse.lastStatus", { status: `${stats.last.code} ${stats.last.name}` })}
      </span>
    </a>
  );
}
