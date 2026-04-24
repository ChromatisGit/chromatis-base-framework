import { idbRequest, getObjectStore, type DbOrTx } from "../transaction.js";

export interface SyncQueueEntry {
  id: string;
  kind: "push" | "operation";
  operation_id: string | null;
  next_attempt_at: string;
  retry_count: number;
  created_at: string;
}

export function makePushQueueEntry(): SyncQueueEntry {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind: "push",
    operation_id: null,
    next_attempt_at: now,
    retry_count: 0,
    created_at: now,
  };
}

export async function enqueueSyncEntry(dbOrTx: DbOrTx, entry: SyncQueueEntry): Promise<void> {
  await idbRequest(getObjectStore(dbOrTx, "sync_queue", "readwrite").put(entry));
}

export async function getDueEntries(db: IDBDatabase): Promise<SyncQueueEntry[]> {
  const now = new Date().toISOString();
  const all = await idbRequest<SyncQueueEntry[]>(getObjectStore(db, "sync_queue").getAll());
  return all.filter((e) => e.next_attempt_at <= now);
}

export async function deleteSyncEntry(db: IDBDatabase, id: string): Promise<void> {
  await idbRequest(getObjectStore(db, "sync_queue", "readwrite").delete(id));
}

export async function updateSyncEntry(db: IDBDatabase, entry: SyncQueueEntry): Promise<void> {
  await idbRequest(getObjectStore(db, "sync_queue", "readwrite").put(entry));
}

export async function resetSyncEntryForOperation(
  db: IDBDatabase,
  operationId: string,
  nowStr: string,
): Promise<void> {
  const all = await idbRequest<SyncQueueEntry[]>(getObjectStore(db, "sync_queue").getAll());
  const entry = all.find((e) => e.operation_id === operationId);
  if (entry) {
    await idbRequest(
      getObjectStore(db, "sync_queue", "readwrite").put({ ...entry, next_attempt_at: nowStr }),
    );
  }
}
