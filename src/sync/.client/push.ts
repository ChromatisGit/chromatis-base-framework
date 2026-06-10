import type { SqliteClient } from "../../sqlite/client.js";
import type { SyncTableConfig, SyncPushPayload } from "../types.js";
import { ident } from "../../sqlite/sql.js";

// Columns that are client-only sync metadata — never sent to the server.
const CLIENT_ONLY_COLS = new Set([
  "sync_state",
  "last_sync_error",
  "local_updated_at",
]);

function stripClientCols(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(([k]) => !CLIENT_ONLY_COLS.has(k)),
  );
}

async function getPendingRows(
  db: SqliteClient,
  tableName: string,
): Promise<Record<string, unknown>[]> {
  return db.query<Record<string, unknown>>({
    text: `SELECT * FROM ${ident(tableName)} WHERE sync_state = 'pending_push'`,
    params: [],
  });
}

async function markSynced(
  db: SqliteClient,
  tableName: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  await db.mutate({
    text: `UPDATE ${ident(tableName)}
           SET sync_state = 'synced', local_updated_at = NULL
           WHERE id IN (${placeholders})`,
    params: ids,
  });
}

export async function executePush(
  db: SqliteClient,
  tables: SyncTableConfig[],
): Promise<void> {
  const payload: SyncPushPayload = {};
  const sentIds: Record<string, string[]> = {};

  for (const table of tables) {
    const rows = await getPendingRows(db, table.name);
    if (rows.length === 0) continue;
    payload[table.name] = rows.map(stripClientCols);
    sentIds[table.name] = rows.map((r) => r["id"] as string);
  }

  if (Object.keys(payload).length === 0) return;

  const response = await fetch("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Push failed: HTTP ${response.status}: ${text}`);
  }

  // Mark all successfully pushed rows as synced.
  for (const [tableName, ids] of Object.entries(sentIds)) {
    await markSynced(db, tableName, ids);
  }
}
