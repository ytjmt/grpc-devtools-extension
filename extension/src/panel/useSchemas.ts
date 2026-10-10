import { useCallback, useEffect, useMemo, useState } from "react";
import { errorText, LocalizedError } from "../i18n";
import { loadDescriptorSet, SchemaIndex, type LoadedSchema } from "../core/schema";
import { defaultScopeFor, isValidScope } from "../core/scope";
import type { SchemaSource } from "../core/storage";
import type { SchemaBackend } from "./schemaBackend";

export interface SchemaEntry {
  source: SchemaSource;
  loaded?: LoadedSchema;
  error?: string;
}

function parse(source: SchemaSource): SchemaEntry {
  try {
    return { source, loaded: loadDescriptorSet(new Uint8Array(source.bytes)) };
  } catch (e) {
    return { source, error: errorText(e) };
  }
}

export function useSchemas(backend: SchemaBackend) {
  const [entries, setEntries] = useState<SchemaEntry[]>([]);
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    const sources = await backend.list();
    sources.sort((a, b) => a.name.localeCompare(b.name));
    setEntries(sources.map(parse));
  }, [backend]);

  const refreshUrl = useCallback(
    async (source: SchemaSource) => {
      if (source.kind !== "url" || !source.url) return;
      const bytes = await backend.fetchDescriptor(source.url);
      await backend.put({ ...source, bytes, updatedAt: backend.now() });
      await reload();
    },
    [backend, reload],
  );

  useEffect(() => {
    (async () => {
      await reload();
      // URL sources follow the server: refresh them every time the panel opens.
      for (const s of await backend.list()) {
        if (s.kind === "url" && s.enabled) await refreshUrl(s).catch((e) => setError(errorText(e)));
      }
    })().catch((e) => setError(errorText(e)));
  }, [backend, reload, refreshUrl]);

  const run = useCallback(
    /** Runs an action, reporting failures via `error`. Resolves to whether it succeeded. */
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      setError(undefined);
      try {
        await fn();
        await reload();
        return true;
      } catch (e) {
        setError(errorText(e));
        return false;
      }
    },
    [reload],
  );

  const actions = useMemo(
    () => ({
      addFiles: (files: File[]) =>
        run(async () => {
          for (const file of files) {
            const bytes = await file.arrayBuffer();
            loadDescriptorSet(new Uint8Array(bytes)); // validate before saving
            await backend.put({
              id: backend.newId(),
              name: file.name,
              kind: "file",
              bytes,
              enabled: true,
              updatedAt: backend.now(),
            });
          }
        }),
      addUrl: (url: string) =>
        run(async () => {
          await backend.ensureHostPermission(url);
          const bytes = await backend.fetchDescriptor(url);
          loadDescriptorSet(new Uint8Array(bytes));
          await backend.put({
            id: backend.newId(),
            name: url,
            kind: "url",
            url,
            bytes,
            enabled: true,
            // Usually the dev server that serves the descriptor also serves the API.
            scopes: [defaultScopeFor(url)],
            updatedAt: backend.now(),
          });
        }),
      replaceFile: (source: SchemaSource, file: File) =>
        run(async () => {
          const bytes = await file.arrayBuffer();
          loadDescriptorSet(new Uint8Array(bytes));
          await backend.put({ ...source, name: file.name, bytes, updatedAt: backend.now() });
        }),
      refresh: (source: SchemaSource) => run(() => refreshUrl(source)),
      setScopes: (source: SchemaSource, scopes: string[]) =>
        run(async () => {
          const invalid = scopes.filter((s) => !isValidScope(s));
          if (invalid.length) throw new LocalizedError({ key: "schemas.invalidScope", params: { scopes: invalid.join(", ") } });
          await backend.put({ ...source, scopes });
        }),
      toggle: (source: SchemaSource) => run(() => backend.put({ ...source, enabled: !source.enabled })),
      remove: (source: SchemaSource) => run(() => backend.remove(source.id)),
    }),
    [backend, run, refreshUrl],
  );

  const index = useMemo(
    () =>
      new SchemaIndex(
        entries.flatMap(({ source, loaded }) =>
          source.enabled && loaded ? [{ id: source.id, name: source.name, scopes: source.scopes ?? [], loaded }] : [],
        ),
      ),
    [entries],
  );

  return { entries, index, error, clearError: () => setError(undefined), ...actions };
}
