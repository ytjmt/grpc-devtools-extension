import { useEffect, useMemo, useRef } from "react";
import { getComment } from "../core/comments";
import { fileSource, sourceText, typeSource } from "../core/protoSource";
import { buildUsages, findType, type UsageRef } from "../core/schemaTree";
import { t } from "../i18n";
import { useCopy } from "./clipboard";
import { Comment, EnumBody, MessageBody, ServiceBody, type TypeLinker } from "./Declarations";
import { ProtoView } from "./ProtoView";
import type { BrowseSchema, BrowseSelection, CallLinks } from "./SchemaBrowser";

/** How a type is shown: as tables, as reconstructed .proto, or within its whole .proto file. */
export type DetailView = "table" | "proto" | "file";

const VIEWS = [
  ["table", "browse.viewTable"],
  ["proto", "browse.viewProto"],
  ["file", "browse.viewFile"],
] as const;

export function TypeDetail({
  schema,
  selection,
  onSelect,
  calls,
  view,
  onViewChange,
}: {
  schema: BrowseSchema;
  selection: BrowseSelection;
  onSelect: (s: BrowseSelection) => void;
  calls?: CallLinks;
  view: DetailView;
  onViewChange: (view: DetailView) => void;
}) {
  const desc = findType(schema.registry, selection.typeName);
  const usages = useMemo(() => buildUsages(schema.registry), [schema.registry]);
  const link = (typeName: string) => () => onSelect({ schemaId: schema.id, typeName });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The file view scrolls to the selected type itself.
    if (view !== "file") ref.current?.scrollTo({ top: 0 });
  }, [selection.typeName, view]);
  const source = useMemo(
    () => (desc && view !== "table" ? (view === "file" ? fileSource(desc.file) : typeSource(desc)) : undefined),
    [desc, view],
  );

  if (!desc) return <div className="empty">{t("browse.notFound", { type: selection.typeName })}</div>;
  return (
    <div ref={ref} className="type-detail">
      <div className="type-detail-head">
        <div className="type-header">
          <span className="type-kind">{desc.kind === "service" ? "service" : desc.kind}</span> <h2>{desc.typeName}</h2>
          {desc.deprecated && <span className="badge warn">{t("browse.deprecated")}</span>}
          <span className="muted"> · {desc.file.proto.name}</span>
        </div>
        <div className="view-bar">
          <div className="view-switch" role="group" aria-label={t("browse.view")}>
            {VIEWS.map(([v, label]) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => onViewChange(v)}>
                {t(label)}
              </button>
            ))}
          </div>
          {source && <CopyButton text={sourceText(source)} />}
        </div>
      </div>
      {source ? (
        <ProtoView
          source={source}
          highlight={view === "file" ? source.ranges.get(desc.typeName) : undefined}
          link={link}
        />
      ) : (
        <>
          <Comment text={getComment(desc)} />
          {desc.kind === "service" && (
            <ServiceBody service={desc} member={selection.member} link={link} schemaId={schema.id} calls={calls} />
          )}
          {desc.kind === "message" && <MessageBody message={desc} link={link} />}
          {desc.kind === "enum" && <EnumBody en={desc} />}
        </>
      )}
      {desc.kind !== "service" && view !== "file" && <Usages refs={usages.get(desc.typeName) ?? []} link={link} />}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, copy] = useCopy();
  return (
    <button type="button" className="copy-source" onClick={() => copy(text)}>
      {copied ? t("detail.copied") : t("browse.copySource")}
    </button>
  );
}

function Usages({ refs, link }: { refs: UsageRef[]; link: TypeLinker }) {
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
