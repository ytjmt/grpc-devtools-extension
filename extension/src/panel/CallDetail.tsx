import type { DescMessage } from "@bufbuild/protobuf";
import { useState } from "react";
import { getComment } from "../core/comments";
import { toBufCurl, toGrpcurl, type SchemaRef } from "../core/curl";
import { fieldAt, fieldLabel, fieldTypeName } from "../core/fields";
import type { DecodedCall, DecodedMessage, Header, RawCall } from "../core/types";
import { renderText, t } from "../i18n";
import { useCopy } from "./clipboard";
import { JsonTree } from "./JsonTree";
import type { CallRow } from "./useDecodedRows";

type Tab = "headers" | "request" | "response" | "trailers";

export function CallDetail({
  row,
  schemaRef,
  onClose,
  onOpenSchemas,
  onOpenType,
}: {
  row: CallRow;
  /** The schema that decoded this call, for "Copy as" commands. */
  schemaRef?: SchemaRef;
  onClose: () => void;
  onOpenSchemas: () => void;
  /** Opens a type of the call's schema in the schema browser. */
  onOpenType?: (typeName: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("response");
  const { raw, call } = row;

  return (
    <div className="detail">
      <div className="detail-bar">
        <div className="tabs">
          <button className="close" title={t("detail.close")} aria-label={t("detail.close")} onClick={onClose}>
            ✕
          </button>
          {(["headers", "request", "response", "trailers"] as const).map((tabName) => (
            <button key={tabName} className={tab === tabName ? "active" : ""} onClick={() => setTab(tabName)}>
              {t(`detail.tab.${tabName}`)}
            </button>
          ))}
        </div>
        {/* Outside .tabs: its horizontal scrolling would clip the menu. */}
        {call && <CopyAsMenu call={call} schemaRef={schemaRef} />}
      </div>
      <div className="tab-body">
        {!call ? (
          <div className="error" role="alert">
            {t("detail.decodeFailed", { error: row.error ?? "" })}
          </div>
        ) : (
          <>
            {call.warnings.map((w, i) => (
              <div key={i} className="warning" role="note">
                {renderText(w)}
              </div>
            ))}
            {!call.schemaFound && call.codec === "proto" && tab !== "headers" && (
              <div className="warning" role="note">
                {call.outOfScopeSchemas.length
                  ? t("detail.outOfScope", { service: call.service, schemas: call.outOfScopeSchemas.join(", ") })
                  : t("detail.noSchema", { service: call.service })}{" "}
                <a href="#" onClick={(e) => (e.preventDefault(), onOpenSchemas())}>
                  {call.outOfScopeSchemas.length ? t("detail.editScope") : t("detail.registerSchema")}
                </a>
              </div>
            )}
            {tab === "headers" && <HeadersTab raw={raw} call={call} />}
            {tab === "request" && <Messages messages={call.requestMessages} onOpenType={onOpenType} />}
            {tab === "response" && (
              <>
                {call.status.code !== 0 && <StatusBox call={call} />}
                <Messages messages={call.responseMessages} onOpenType={onOpenType} />
              </>
            )}
            {tab === "trailers" && (
              <>
                <StatusBox call={call} />
                <HeaderTable headers={call.trailers} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function HeadersTab({ raw, call }: { raw: RawCall; call: DecodedCall }) {
  return (
    <>
      <Section title={t("detail.general")}>
        <HeaderTable
          headers={[
            { name: t("detail.rpc"), value: call.path },
            { name: t("detail.url"), value: raw.url },
            { name: t("detail.protocol"), value: `${call.transport} / ${call.codec}` },
            { name: t("detail.httpStatus"), value: String(raw.httpStatus) },
            { name: t("detail.grpcStatus"), value: `${call.status.code} ${call.status.name}` },
            { name: t("detail.schema"), value: call.schemaName ?? "-" },
            { name: t("detail.started"), value: raw.startedDateTime },
            { name: t("detail.duration"), value: `${raw.time.toFixed(1)} ms` },
          ]}
        />
      </Section>
      <Section title={t("detail.responseHeaders")}>
        <HeaderTable headers={raw.responseHeaders} />
      </Section>
      <Section title={t("detail.requestHeaders")}>
        <HeaderTable headers={raw.requestHeaders} />
      </Section>
    </>
  );
}

function StatusBox({ call }: { call: DecodedCall }) {
  const { status } = call;
  return (
    <div className={`status-box ${status.code === 0 ? "ok" : "failed"}`}>
      <strong>
        {status.code} {status.name}
      </strong>
      {status.message !== undefined && <span> — {renderText(status.message)}</span>}
      {status.details !== undefined && <JsonTree name="details" value={status.details} />}
    </div>
  );
}

function Messages({ messages, onOpenType }: { messages: DecodedMessage[]; onOpenType?: (typeName: string) => void }) {
  if (messages.length === 0) return <div className="empty">{t("detail.noMessages")}</div>;
  return (
    <>
      {messages.map((m, i) => (
        <MessageView key={i} index={i} count={messages.length} message={m} onOpenType={onOpenType} />
      ))}
    </>
  );
}

/** Tooltip text for JSON keys: field number, name, type, and the .proto comment. */
function fieldDescriber(type: DescMessage) {
  return (path: string[]) => {
    const field = fieldAt(type, path);
    if (!field) return undefined;
    const label = fieldLabel(field);
    return [
      t("detail.fieldInfo", {
        number: field.number,
        name: field.name,
        type: `${label ? `${label} ` : ""}${fieldTypeName(field)}`,
      }),
      field.deprecated ? t("browse.deprecated") : undefined,
      getComment(field),
    ]
      .filter(Boolean)
      .join("\n");
  };
}

function MessageView({
  message,
  index,
  count,
  onOpenType,
}: {
  message: DecodedMessage;
  index: number;
  count: number;
  onOpenType?: (typeName: string) => void;
}) {
  const [copied, copyNow] = useCopy();
  const copy = () => copyNow(JSON.stringify(message.value, null, 2));
  const { type } = message;
  return (
    <div className="message">
      <div className="message-header">
        {count > 1 && <span className="index">#{index + 1}</span>}
        {type && onOpenType ? (
          <a
            href="#"
            className="type type-link"
            title={t("detail.openType", { type: type.typeName })}
            onClick={(e) => {
              e.preventDefault();
              onOpenType(type.typeName);
            }}
          >
            {type.typeName}
          </a>
        ) : (
          <span className="type">{message.typeName ?? t("detail.unknownType")}</span>
        )}
        <span className={`badge via-${message.via}`}>{message.via}</span>
        <span className="size">{message.size} B</span>
        <span className="spacer" />
        <button onClick={copy}>{copied ? t("detail.copied") : t("detail.copyJson")}</button>
      </div>
      {message.error !== undefined && (
        <div className="warning" role="note">
          {renderText(message.error)}
        </div>
      )}
      {message.unknownFields && (
        <div className="warning" role="note">
          {t("detail.unknownFields", {
            type: message.typeName ?? "",
            fields: message.unknownFields.map((u) => (u.path ? `${u.path} #${u.number}` : `#${u.number}`)).join(", "),
          })}
        </div>
      )}
      <JsonTree value={message.value} describe={type ? fieldDescriber(type) : undefined} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="section">
      <summary>{title}</summary>
      {children}
    </details>
  );
}

function HeaderTable({ headers }: { headers: Header[] }) {
  if (headers.length === 0) return <div className="empty">{t("detail.none")}</div>;
  return (
    <table className="headers">
      <tbody>
        {headers.map((h, i) => (
          <tr key={i}>
            <th>{h.name}</th>
            <td>{h.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CopyAsMenu({ call, schemaRef }: { call: DecodedCall; schemaRef?: SchemaRef }) {
  const [open, setOpen] = useState(false);
  const [copied, copy] = useCopy();
  const items = [
    { label: t("detail.copyBufCurl"), command: toBufCurl(call, schemaRef) },
    { label: t("detail.copyGrpcurl"), command: toGrpcurl(call, schemaRef) },
  ];
  return (
    <div
      className="copy-as"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {copied ? t("detail.copied") : t("detail.copyAs")}
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              disabled={!item.command}
              title={item.command ? undefined : t("detail.copyUnavailable")}
              onClick={() => {
                copy(item.command!);
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
