import { runTransaction, idbRequest, getObjectStore } from "./local-db/transaction.js";
import { getAllCursors, setSyncCursor } from "./local-db/repos/syncStateRepo.js";

export type SyncCollection = {
  key: string;
  storeName: string;
  mode: "conflict" | "simple";
  transform?: (row: unknown) => unknown;
};

type Mergeable = {
  id: string;
  sync_state: string;
  last_sync_error: string | null;
  local_updated_at: string | null;
};

function asSynced<T extends Mergeable>(row: T): T {
  return { ...row, sync_state: "synced", last_sync_error: null, local_updated_at: null };
}

async function mergeWithConflict<T extends Mergeable>(
  db: IDBDatabase,
  storeName: string,
  rows: T[],
): Promise<void> {
  if (!rows.length) return;
  await runTransaction(db, [storeName], "readwrite", async (tx) => {
    const store = getObjectStore(tx, storeName);
    for (const row of rows) {
      const existing = await idbRequest<T | undefined>(store.get(row.id));
      if (existing?.sync_state === "pending_push") {
        store.put({ ...existing, sync_state: "conflict" });
      } else {
        store.put(asSynced(row));
      }
    }
  });
}

async function mergeSimple<T extends Mergeable>(
  db: IDBDatabase,
  storeName: string,
  rows: T[],
): Promise<void> {
  if (!rows.length) return;
  await runTransaction(db, [storeName], "readwrite", async (tx) => {
    const store = getObjectStore(tx, storeName);
    for (const row of rows) store.put(asSynced(row));
  });
}

export async function syncPull(
  db: IDBDatabase,
  collections: SyncCollection[],
): Promise<void> {
  const cursors = await getAllCursors(db);

  const response = await fetch("/api/sync/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cursors }),
  });

  if (!response.ok) throw new Error(`Pull failed: ${response.status}`);

  const data = await response.json() as Record<string, unknown> & { newCursors: Record<string, number> };

  for (const col of collections) {
    const raw = data[col.key];
    if (!Array.isArray(raw)) continue;
    const rows = col.transform ? raw.map(col.transform) : raw;

    if (col.mode === "conflict") {
      await mergeWithConflict(db, col.storeName, rows as Mergeable[]);
    } else {
      await mergeSimple(db, col.storeName, rows as Mergeable[]);
    }
  }

  for (const [collection, cursor] of Object.entries(data.newCursors)) {
    await setSyncCursor(db, collection, cursor);
  }

  window.dispatchEvent(new CustomEvent("desk:synced"));
}
