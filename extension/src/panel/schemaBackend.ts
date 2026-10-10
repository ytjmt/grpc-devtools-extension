import { LocalizedError } from "../i18n";
import { schemaStore, type SchemaSource } from "../core/storage";

/** Everything schema management needs from the outside world; swapped for a fake in tests. */
export interface SchemaBackend {
  list(): Promise<SchemaSource[]>;
  put(source: SchemaSource): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  fetchDescriptor(url: string): Promise<ArrayBuffer>;
  /** Extension pages need host permission to fetch cross-origin. Must run in a user gesture. */
  ensureHostPermission(url: string): Promise<void>;
  now(): number;
  newId(): string;
}

export const chromeSchemaBackend: SchemaBackend = {
  ...schemaStore,
  async fetchDescriptor(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new LocalizedError({ key: "schemas.fetchFailed", params: { url, status: res.status } });
    return res.arrayBuffer();
  },
  async ensureHostPermission(url) {
    const origins = [`${new URL(url).origin}/*`];
    if (await chrome.permissions.contains({ origins })) return;
    if (!(await chrome.permissions.request({ origins }))) {
      throw new LocalizedError({ key: "schemas.permissionDenied", params: { origin: new URL(url).origin } });
    }
  },
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
};
