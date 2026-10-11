import { useId, useRef, useState } from "react";
import type { SchemaSource } from "../core/storage";
import { t } from "../i18n";
import { parseScopes } from "../core/scope";
import type { SchemaEntry, useSchemas } from "./useSchemas";

export function SchemasView({ schemas }: { schemas: ReturnType<typeof useSchemas> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<SchemaSource>(undefined);
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);

  return (
    <div className="schemas">
      <div
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => (e.preventDefault(), setDragging(true))}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          schemas.addFiles([...e.dataTransfer.files]);
        }}
      >
        <p>
          {t("schemas.drop")} <button onClick={() => fileInput.current?.click()}>{t("schemas.chooseFile")}</button>
        </p>
        <pre>
          {`buf build -o descriptor.binpb
# ${t("schemas.or")}
protoc -I proto --include_imports --descriptor_set_out=descriptor.binpb proto/**/*.proto`}
        </pre>
        <input
          ref={fileInput}
          data-testid="schema-file-input"
          type="file"
          multiple
          hidden
          onChange={(e) => {
            schemas.addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      <form
        className="url-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) schemas.addUrl(url.trim()).then((ok) => ok && setUrl(""));
        }}
      >
        <input
          type="url"
          placeholder={t("schemas.urlPlaceholder")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit">{t("schemas.addUrl")}</button>
        <span className="hint">{t("schemas.urlHint")}</span>
      </form>

      {schemas.error && (
        <div className="error" role="alert">
          {schemas.error}{" "}
          <button aria-label={t("schemas.dismissError")} title={t("schemas.dismissError")} onClick={schemas.clearError}>
            ✕
          </button>
        </div>
      )}

      <input
        ref={replaceInput}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && replaceTarget.current) schemas.replaceFile(replaceTarget.current, f);
          e.target.value = "";
        }}
      />

      {schemas.entries.length === 0 ? (
        <div className="empty">{t("schemas.empty")}</div>
      ) : (
        schemas.entries.map((entry) => (
          <SchemaCard
            key={entry.source.id}
            entry={entry}
            others={schemas.entries.filter((e) => e !== entry && e.source.enabled)}
            schemas={schemas}
            onReplace={() => {
              replaceTarget.current = entry.source;
              replaceInput.current?.click();
            }}
          />
        ))
      )}
    </div>
  );
}

function SchemaCard({
  entry: { source, loaded, error },
  others,
  schemas,
  onReplace,
}: {
  entry: SchemaEntry;
  others: SchemaEntry[];
  schemas: ReturnType<typeof useSchemas>;
  onReplace: () => void;
}) {
  // Services shared with another enabled schema at the same priority for the same requests.
  // Scoped-vs-unscoped or disjoint scopes are intentional setups and are not flagged.
  const scopes = source.scopes ?? [];
  const sameRequests = (o: SchemaEntry) => {
    const theirs = o.source.scopes ?? [];
    return scopes.length === 0 ? theirs.length === 0 : theirs.some((p) => scopes.includes(p));
  };
  const duplicates =
    source.enabled && loaded
      ? others.filter(sameRequests).flatMap((o) => {
          const shared = loaded.services.filter((svc) => o.loaded?.services.includes(svc));
          return shared.length ? [{ name: o.source.name, shared }] : [];
        })
      : [];

  return (
    <div className={`schema ${source.enabled ? "" : "disabled"}`}>
      <div className="schema-header">
        <input
          type="checkbox"
          aria-label={t("schemas.enable", { name: source.name })}
          checked={source.enabled}
          onChange={() => schemas.toggle(source)}
        />
        <strong>{source.name}</strong>
        <span className="badge">{source.kind}</span>
        <span className="muted">
          {t("schemas.updated", { date: new Date(source.updatedAt).toLocaleString("en-US") })}
        </span>
        <span className="spacer" />
        {source.kind === "url" ? (
          <button onClick={() => schemas.refresh(source)}>{t("schemas.refresh")}</button>
        ) : (
          <button onClick={onReplace}>{t("schemas.replace")}</button>
        )}
        <button onClick={() => schemas.remove(source)}>{t("schemas.delete")}</button>
      </div>
      <ScopeEditor scopes={source.scopes ?? []} onSave={(scopes) => schemas.setScopes(source, scopes)} />
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {loaded && (
        <ul className="services">
          {loaded.services.map((svc) => (
            <li key={svc}>{svc}</li>
          ))}
          {loaded.services.length === 0 && <li className="muted">{t("schemas.noServices")}</li>}
        </ul>
      )}
      {loaded && loaded.skipped.length > 0 && (
        <div className="warning" role="note">
          {t("schemas.skipped", { files: loaded.skipped.join(", ") })}
        </div>
      )}
      {duplicates.map((d) => (
        <div key={d.name} className="warning" role="note">
          {t("schemas.duplicateServices", { schemas: d.name, services: d.shared.join(", ") })}
        </div>
      ))}
    </div>
  );
}

function ScopeEditor({ scopes, onSave }: { scopes: string[]; onSave: (scopes: string[]) => Promise<boolean> }) {
  const [draft, setDraft] = useState<string>();
  const inputId = useId();
  const label = t("schemas.scopes");

  if (draft === undefined) {
    return (
      <div className="scopes">
        <span className="scopes-label">{label}</span>
        {scopes.length ? (
          <span className="scopes-list">
            {scopes.map((s) => (
              <code key={s}>{s}</code>
            ))}
          </span>
        ) : (
          <span className="muted">{t("schemas.scopesAll")}</span>
        )}
        <button onClick={() => setDraft(scopes.join("\n"))}>{t("schemas.editScopes")}</button>
      </div>
    );
  }

  return (
    <form
      className="scopes editing"
      onSubmit={async (e) => {
        e.preventDefault();
        // Keep the editor open on invalid input so it can be fixed.
        if (await onSave(parseScopes(draft))) setDraft(undefined);
      }}
    >
      <label className="scopes-label" htmlFor={inputId}>
        {label}
      </label>
      <textarea
        id={inputId}
        rows={Math.max(2, draft.split("\n").length)}
        placeholder={t("schemas.scopesPlaceholder")}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button type="submit">{t("schemas.saveScopes")}</button>
      <button type="button" onClick={() => setDraft(undefined)}>
        {t("schemas.cancel")}
      </button>
    </form>
  );
}
