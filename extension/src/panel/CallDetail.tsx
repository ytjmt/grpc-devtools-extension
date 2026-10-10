import { useState } from "react";
import { renderText, t } from "../i18n";
import type { DecodedCall, DecodedMessage, Header, RawCall } from "../core/types";
import { JsonTree } from "./JsonTree";
import type { CallRow } from "./useDecodedRows";

type Tab = "headers" | "request" | "response" | "trailers";

export function CallDetail({
  row,
  onClose,
  onOpenSchemas,
}: {
  row: CallRow;
  onClose: () => void;
  onOpenSchemas: () => void;
}) {
  const [tab, setTab] = useState<Tab>("response");
  const { raw, call } = row;

  return (
    <div className="detail">
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
      <div className="tab-body">
        {!call ? (
          <div className="error" role="alert">{t("detail.decodeFailed", { error: row.error ?? "" })}</div>
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
            {tab === "request" && <Messages messages={call.requestMessages} />}
            {tab === "response" && (
              <>
                {call.status.code !== 0 && <StatusBox call={call} />}
                <Messages messages={call.responseMessages} />
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

function Messages({ messages }: { messages: DecodedMessage[] }) {
  if (messages.length === 0) return <div className="empty">{t("detail.noMessages")}</div>;
  return (
    <>
      {messages.map((m, i) => (
        <MessageView key={i} index={i} count={messages.length} message={m} />
      ))}
    </>
  );
}

function MessageView({ message, index, count }: { message: DecodedMessage; index: number; count: number }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    // navigator.clipboard is blocked in DevTools panels; use a textarea fallback.
    const ta = document.createElement("textarea");
    ta.value = JSON.stringify(message.value, null, 2);
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };
  return (
    <div className="message">
      <div className="message-header">
        {count > 1 && <span className="index">#{index + 1}</span>}
        <span className="type">{message.typeName ?? t("detail.unknownType")}</span>
        <span className={`badge via-${message.via}`}>{message.via}</span>
        <span className="size">{message.size} B</span>
        <span className="spacer" />
        <button onClick={copy}>{copied ? t("detail.copied") : t("detail.copyJson")}</button>
      </div>
      {message.error !== undefined && <div className="warning" role="note">{renderText(message.error)}</div>}
      <JsonTree value={message.value} />
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
