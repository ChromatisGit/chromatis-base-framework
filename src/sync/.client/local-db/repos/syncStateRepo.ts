import { idbRequest } from "../transaction.js";

interface SyncStateCursor {
  collection: string;
  cursor: number;
}

export async function getSyncCursor(db: IDBDatabase, collection: string): Promise<number> {
  const store = db.transaction("sync_state", "readonly").objectStore("sync_state");
  const row = await idbRequest<SyncStateCursor | undefined>(store.get(collection));
  return row?.cursor ?? 0;
}

export async function setSyncCursor(
  db: IDBDatabase,
  collection: string,
  cursor: number,
): Promise<void> {
  const store = db.transaction("sync_state", "readwrite").objectStore("sync_state");
  await idbRequest(store.put({ collection, cursor }));
}

export async function getAllCursors(db: IDBDatabase): Promise<Record<string, number>> {
  const store = db.transaction("sync_state", "readonly").objectStore("sync_state");
  const all = await idbRequest<SyncStateCursor[]>(store.getAll());
  const result: Record<string, number> = {};
  for (const row of all) result[row.collection] = row.cursor;
  return result;
}
