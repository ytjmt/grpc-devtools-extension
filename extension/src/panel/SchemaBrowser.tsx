import type { DescEnum, DescField, DescMessage, DescOneof, DescService, FileRegistry } from "@bufbuild/protobuf";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getComment } from "../core/comments";
import { fieldLabel, fieldTypeName, fieldTypeRef } from "../core/fields";
import { buildTree, buildUsages, filterTree, findType, type TreeNode, type UsageRef } from "../core/schemaTree";
import { t } from "../i18n";

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

export function SchemaBrowser({
  schemas,
  selection,
  onSelect,
}: {
  schemas: BrowseSchema[];
  selection?: BrowseSelection;
  onSelect: (selection: BrowseSelection) => void;
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
                />
              ))}
            </div>
          ))}
          {filtered.length === 0 && <div className="empty">{t("browse.noMatches")}</div>}
        </div>
      </div>
      <div className="browser-detail">
        {current && selectedSchema ? (
          <TypeDetail schema={selectedSchema} selection={current} onSelect={onSelect} />
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
}: {
  node: TreeNode;
  depth: number;
  schemaId: string;
  forceOpen: boolean;
  selection?: BrowseSelection;
  onSelect: (s: BrowseSelection) => void;
}) {
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
}: {
  schema: BrowseSchema;
  selection: BrowseSelection;
  onSelect: (s: BrowseSelection) => void;
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
      {desc.kind === "service" && <ServiceBody service={desc} member={selection.member} link={link} />}
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
}: {
  service: DescService;
  member?: string;
  link: (t: string) => () => void;
}) {
  const highlighted = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    highlighted.current?.scrollIntoView({ block: "nearest" });
  }, [member]);
  return (
    <table className="decl-table">
      <thead>
        <tr>
          <th>{t("browse.method")}</th>
          <th>{t("browse.kind")}</th>
          <th>{t("browse.request")}</th>
          <th>{t("browse.response")}</th>
        </tr>
      </thead>
      <tbody>
        {service.methods.map((m) => (
          <Fragment key={m.name}>
            <tr ref={m.name === member ? highlighted : undefined} className={m.name === member ? "highlight" : ""}>
              <td className={m.deprecated ? "deprecated" : ""}>{m.name}</td>
              <td>{t(METHOD_KINDS[m.methodKind])}</td>
              <td>
                <TypeLink typeName={m.input.typeName} link={link} />
              </td>
              <td>
                <TypeLink typeName={m.output.typeName} link={link} />
              </td>
            </tr>
            {getComment(m) && (
              <tr className={`comment-row ${m.name === member ? "highlight" : ""}`}>
                <td colSpan={4}>{getComment(m)}</td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
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
