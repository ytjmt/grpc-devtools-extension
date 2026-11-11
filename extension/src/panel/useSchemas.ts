import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText, LocalizedError } from "../i18n";
import { loadDescriptorSet, SchemaIndex, type IndexedSchema, type LoadedSchema } from "../core/schema";
import { defaultScopeFor, isValidScope } from "../core/scope";
import type { SchemaSource } from "../core/storage";
import type { SchemaBackend } from "./schemaBackend";

export interface SchemaEntry {
  source: SchemaSource;
  loaded?: LoadedSchema;
  error?: string;
}

type Parsed = Omit<SchemaEntry, "source">;

function parse(bytes: Uint8Array): Parsed {
  try {
    return { loaded: loadDescriptorSet(bytes) };
  } catch (e) {
    return { error: errorText(e) };
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Parses sources, reusing the previous result for a source whose bytes did not
 * change: toggling, rescoping, or re-fetching an unchanged URL needs no re-parse.
 */
function useParser() {
  const cache = useRef(new Map<string, { bytes: Uint8Array; parsed: Parsed }>());
  return useCallback((sources: SchemaSource[]): SchemaEntry[] => {
    const next = new Map<string, { bytes: Uint8Array; parsed: Parsed }>();
    const entries = sources.map((source) => {
      const bytes = new Uint8Array(source.bytes);
      const cached = cache.current.get(source.id);
      const parsed = cached && sameBytes(cached.bytes, bytes) ? cached.parsed : parse(bytes);
      next.set(source.id, { bytes, parsed });
      return { source, ...parsed };
    });
    cache.current = next;
    return entries;
  }, []);
}

/** A new SchemaIndex only when what decoding depends on changed, so recorded calls are not re-decoded needlessly. */
function useSchemaIndex(entries: SchemaEntry[]): SchemaIndex {
  const prev = useRef<{ schemas: IndexedSchema[]; index: SchemaIndex }>(undefined);
  return useMemo(() => {
    const schemas = entries.flatMap(({ source, loaded }) =>
      source.enabled && loaded ? [{ id: source.id, name: source.name, scopes: source.scopes ?? [], loaded }] : [],
    );
    const p = prev.current;
    const same =
      p !== undefined &&
      p.schemas.length === schemas.length &&
      p.schemas.every(
        (s, i) =>
          s.id === schemas[i].id &&
          s.name === schemas[i].name &&
          s.loaded === schemas[i].loaded &&
          s.scopes.join("\n") === schemas[i].scopes.join("\n"),
      );
    if (same) return p.index;
    const index = new SchemaIndex(schemas);
    prev.current = { schemas, index };
    return index;
  }, [entries]);
}

export function useSchemas(backend: SchemaBackend) {
  const [entries, setEntries] = useState<SchemaEntry[]>([]);
  const [error, setError] = useState<string>();

  const parseAll = useParser();

  const reload = useCallback(async () => {
    const sources = await backend.list();
    sources.sort((a, b) => a.name.localeCompare(b.name));
    setEntries(parseAll(sources));
    return sources;
  }, [backend, parseAll]);

  /** Re-fetches a URL source and stores it; callers reload afterwards. */
  const fetchUrl = useCallback(
    async (source: SchemaSource) => {
      if (source.kind !== "url" || !source.url) return;
      const bytes = await backend.fetchDescriptor(source.url);
      await backend.put({ ...source, bytes, updatedAt: backend.now() });
    },
    [backend],
  );

  useEffect(() => {
    (async () => {
      const sources = await reload();
      // URL sources follow the server: refresh them every time the panel opens, all at once.
      const results = await Promise.allSettled(sources.filter((s) => s.kind === "url" && s.enabled).map(fetchUrl));
      const failed = results.find((r) => r.status === "rejected");
      if (failed) setError(errorText(failed.reason));
      if (results.some((r) => r.status === "fulfilled")) await reload();
    })().catch((e) => setError(errorText(e)));
  }, [reload, fetchUrl]);

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
      refresh: (source: SchemaSource) => run(() => fetchUrl(source)),
      setScopes: (source: SchemaSource, scopes: string[]) =>
        run(async () => {
          const invalid = scopes.filter((s) => !isValidScope(s));
          if (invalid.length)
            throw new LocalizedError({ key: "schemas.invalidScope", params: { scopes: invalid.join(", ") } });
          await backend.put({ ...source, scopes });
        }),
      toggle: (source: SchemaSource) => run(() => backend.put({ ...source, enabled: !source.enabled })),
      remove: (source: SchemaSource) => run(() => backend.remove(source.id)),
    }),
    [backend, run, fetchUrl],
  );

  const index = useSchemaIndex(entries);

  return { entries, index, error, clearError: () => setError(undefined), ...actions };
}
