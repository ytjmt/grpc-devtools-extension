/** Registered schema sources, persisted in IndexedDB (descriptor sets can be several MB). */
export interface SchemaSource {
  id: string;
  name: string;
  kind: "file" | "url";
  /** For kind "url": re-fetched on panel open and on demand. */
  url?: string;
  bytes: ArrayBuffer;
  enabled: boolean;
  /** Request-URL patterns (see core/scope.ts). Missing or empty = every request. */
  scopes?: string[];
  updatedAt: number;
}

const DB = "grpc-devtools";
const STORE = "schemas";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const schemaStore = {
  list: () => tx<SchemaSource[]>("readonly", (s) => s.getAll() as IDBRequest<SchemaSource[]>),
  put: (src: SchemaSource) => tx("readwrite", (s) => s.put(src)),
  remove: (id: string) => tx("readwrite", (s) => s.delete(id)),
};
