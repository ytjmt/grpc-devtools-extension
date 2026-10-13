import type { DescEnum, DescField, DescMessage, DescOneof, DescService } from "@bufbuild/protobuf";
import { Fragment, useEffect, useRef } from "react";
import { getComment } from "../core/comments";
import { fieldLabel, fieldTypeName, fieldTypeRef } from "../core/fields";
import { t } from "../i18n";
import { methodKey } from "./methodStats";
import type { CallLinks } from "./SchemaBrowser";

/** Tables for services, messages, and enums in the schema browser's table view. */

/** Returns a handler that opens `typeName` in the schema browser. */
export type TypeLinker = (typeName: string) => () => void;

export function Comment({ text }: { text?: string }) {
  return text ? <p className="comment">{text}</p> : null;
}

function TypeLink({ typeName, link }: { typeName: string; link: TypeLinker }) {
  return (
    <a
      href="#"
      className="type-link"
      onClick={(e) => {
        e.preventDefault();
        link(typeName)();
      }}
    >
      <QualifiedName name={typeName} />
    </a>
  );
}

/** A dotted name that may wrap only after its dots, never inside a segment. */
function QualifiedName({ name }: { name: string }) {
  const parts = name.split(".");
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              .<wbr />
            </>
          )}
        </Fragment>
      ))}
    </>
  );
}

const METHOD_KINDS = {
  unary: "browse.unary",
  server_streaming: "browse.serverStreaming",
  client_streaming: "browse.clientStreaming",
  bidi_streaming: "browse.bidiStreaming",
} as const;

export function ServiceBody({
  service,
  member,
  link,
  schemaId,
  calls,
}: {
  service: DescService;
  member?: string;
  link: TypeLinker;
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

export function MessageBody({ message, link }: { message: DescMessage; link: TypeLinker }) {
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

function OneofRows({ oneof, link }: { oneof: DescOneof; link: TypeLinker }) {
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

function FieldRow({ field, link, inOneof }: { field: DescField; link: TypeLinker; inOneof?: boolean }) {
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

export function EnumBody({ en }: { en: DescEnum }) {
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
        {en.values.map((v) => {
          // With allow_alias, the first value with a number is the name shown in decoded messages.
          const primary = en.values.find((o) => o.number === v.number)!;
          return (
            <tr key={v.name}>
              <td className="num">{v.number}</td>
              <td className="mono">
                <span className={v.deprecated ? "deprecated" : ""}>{v.name}</span>
                {primary !== v && <span className="muted"> ({t("browse.aliasOf", { name: primary.name })})</span>}
                {v.deprecated && <span className="badge warn">{t("browse.deprecated")}</span>}
              </td>
              <td>{getComment(v)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
