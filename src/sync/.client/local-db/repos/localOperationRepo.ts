import { idbRequest, getObjectStore, type DbOrTx } from "../transaction.js";
import type { LocalOperation } from "@platform/operations/types.js";

export async function putLocalOperation(dbOrTx: DbOrTx, op: LocalOperation): Promise<void> {
  await idbRequest(getObjectStore(dbOrTx, "local_operations", "readwrite").put(op));
}

export function getLocalOperation(
  db: IDBDatabase,
  id: string,
): Promise<LocalOperation | undefined> {
  return idbRequest<LocalOperation | undefined>(
    getObjectStore(db, "local_operations").get(id),
  );
}

export async function getQueuedOperations(db: IDBDatabase): Promise<LocalOperation[]> {
  const all = await idbRequest<LocalOperation[]>(
    getObjectStore(db, "local_operations").getAll(),
  );
  return all.filter((op) => op.queue_state === "queued" || op.queue_state === "retry_wait");
}

export async function getRetryingOperations(db: IDBDatabase): Promise<Map<string, string>> {
  const all = await idbRequest<LocalOperation[]>(
    getObjectStore(db, "local_operations").getAll(),
  );
  return new Map(
    all
      .filter((op) => op.queue_state === "retry_wait" && op.next_attempt_at)
      .map((op) => [op.id, op.next_attempt_at!]),
  );
}

export async function resetStuckOperations(db: IDBDatabase): Promise<void> {
  const all = await idbRequest<LocalOperation[]>(
    getObjectStore(db, "local_operations").getAll(),
  );
  const stuck = all.filter((op) => op.queue_state === "running");
  const store = getObjectStore(db, "local_operations", "readwrite");
  const nowStr = new Date().toISOString();
  for (const op of stuck) {
    await idbRequest(
      store.put({ ...op, queue_state: "queued", next_attempt_at: nowStr, updated_at: nowStr }),
    );
  }
}
