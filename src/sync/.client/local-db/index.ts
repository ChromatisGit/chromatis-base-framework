export type IndexDef = {
  name: string;
  keyPath: string;
  unique?: boolean;
};

export type StoreDef = {
  name: string;
  keyPath: string;
  indexes?: IndexDef[];
};

const PLATFORM_STORES: StoreDef[] = [
  {
    name: "sync_queue",
    keyPath: "id",
    indexes: [
      { name: "by_kind", keyPath: "kind" },
      { name: "by_next_attempt_at", keyPath: "next_attempt_at" },
    ],
  },
  {
    name: "sync_state",
    keyPath: "collection",
  },
  {
    name: "local_operations",
    keyPath: "id",
    indexes: [
      { name: "by_queue_state", keyPath: "queue_state" },
      { name: "by_prompt_id", keyPath: "prompt_id" },
    ],
  },
];

let _db: IDBDatabase | null = null;

export async function openDb(
  name: string,
  version: number,
  appStores: StoreDef[],
): Promise<IDBDatabase> {
  if (_db) return _db;

  const allStores = [...PLATFORM_STORES, ...appStores];

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      for (const storeName of Array.from(db.objectStoreNames)) {
        db.deleteObjectStore(storeName);
      }

      for (const def of allStores) {
        const store = db.createObjectStore(def.name, { keyPath: def.keyPath });
        for (const idx of def.indexes ?? []) {
          store.createIndex(idx.name, idx.keyPath, { unique: idx.unique ?? false });
        }
      }
    };

    request.onsuccess = (event) => {
      _db = (event.target as IDBOpenDBRequest).result;
      resolve(_db);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}
