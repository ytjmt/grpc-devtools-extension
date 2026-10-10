import type { SchemaSource } from "../../extension/src/core/storage";
import { LocalizedError } from "../../extension/src/i18n";
import type { SchemaBackend } from "../../extension/src/panel/schemaBackend";

/** In-memory SchemaBackend with a fixed clock and sequential ids. */
export function fakeSchemaBackend(options: {
  sources?: SchemaSource[];
  /** URL → descriptor bytes served by fetchDescriptor. */
  urls?: Record<string, ArrayBuffer>;
  grantPermission?: boolean;
} = {}) {
  const sources = new Map((options.sources ?? []).map((s) => [s.id, s]));
  let id = 0;
  const backend: SchemaBackend = {
    list: async () => [...sources.values()],
    put: async (s) => void sources.set(s.id, s),
    remove: async (key) => void sources.delete(key),
    async fetchDescriptor(url) {
      const bytes = options.urls?.[url];
      if (!bytes) throw new LocalizedError({ key: "schemas.fetchFailed", params: { url, status: 404 } });
      return bytes;
    },
    async ensureHostPermission(url) {
      if (options.grantPermission === false) {
        throw new LocalizedError({ key: "schemas.permissionDenied", params: { origin: new URL(url).origin } });
      }
    },
    now: () => Date.UTC(2026, 0, 1, 9, 0, 0),
    newId: () => `schema-${++id}`,
  };
  return { backend, sources };
}

export async function loadDescriptor(url: string): Promise<ArrayBuffer> {
  return (await fetch(url)).arrayBuffer();
}
