import type { SqliteClient } from "../../sqlite/client.js";
import type {
  SyncTableConfig,
  SyncPullRequest,
  SyncPullResponse,
} from "../types.js";
import { ident } from "../../sqlite/sql.js";

export const SYNC_COMPLETE_EVENT = "platform:synced";

// sqlite-wasm bind() only accepts primitives. JSON columns arrive from the
// server as parsed objects — stringify them back to TEXT for SQLite storage.
function serializeForSqlite(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      v !== null && typeof v === "object" ? JSON.stringify(v) : v,
    ]),
  );
}

async function getCursors(db: SqliteClient): Promise<Record<string, number>> {
  const rows = await db.query<{ table_name: string; cursor: number }>({
    text: "SELECT table_name, cursor FROM sync_cursors",
    params: [],
  });
  return Object.fromEntries(rows.map((r) => [r.table_name, r.cursor]));
}

async function setCursor(
  db: SqliteClient,
  tableName: string,
  cursor: number,
): Promise<void> {
  await db.mutate({
    text: `INSERT INTO sync_cursors (table_name, cursor)
           VALUES (?, ?)
           ON CONFLICT (table_name) DO UPDATE SET cursor = excluded.cursor`,
    params: [tableName, cursor],
  });
}

async function mergeRows(
  db: SqliteClient,
  table: SyncTableConfig,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;

  const transformed = (table.transform ? rows.map(table.transform) : rows)
    .map(serializeForSqlite);

  if (table.mode === "server_wins") {
    // Server row always wins — upsert directly with sync_state = 'synced'.
    for (const row of transformed) {
      const cols = Object.keys(row);
      const colList = cols.map(ident).join(", ");
      const placeholders = cols.map(() => "?").join(", ");
      const updateSet = cols
        .filter((c) => c !== "id")
        .map((c) => `${ident(c)} = excluded.${ident(c)}`)
        .join(", ");

      await db.mutate({
        text: `INSERT INTO ${ident(table.name)} (${colList}, sync_state)
               VALUES (${placeholders}, 'synced')
               ON CONFLICT (id) DO UPDATE SET
                 ${updateSet},
                 sync_state = 'synced',
                 local_updated_at = NULL`,
        params: Object.values(row),
      });
    }
    return;
  }

  // merge mode: if the local row is pending_push, mark as conflict.
  // Otherwise accept the server version.
  for (const row of transformed) {
    const id = row["id"] as string;
    const existing = await db.query<{ sync_state: string }>({
      text: `SELECT sync_state FROM ${ident(table.name)} WHERE id = ?`,
      params: [id],
    });

    const localPending = existing[0]?.sync_state === "pending_push";

    if (localPending) {
      await db.mutate({
        text: `UPDATE ${ident(table.name)} SET sync_state = 'conflict' WHERE id = ?`,
        params: [id],
      });
    } else {
      const cols = Object.keys(row);
      const colList = cols.map(ident).join(", ");
      const placeholders = cols.map(() => "?").join(", ");
      const updateSet = cols
        .filter((c) => c !== "id")
        .map((c) => `${ident(c)} = excluded.${ident(c)}`)
        .join(", ");

      await db.mutate({
        text: `INSERT INTO ${ident(table.name)} (${colList}, sync_state)
               VALUES (${placeholders}, 'synced')
               ON CONFLICT (id) DO UPDATE SET
                 ${updateSet},
                 sync_state = 'synced',
                 local_updated_at = NULL`,
        params: Object.values(row),
      });
    }
  }
}

export async function executePull(
  db: SqliteClient,
  tables: SyncTableConfig[],
): Promise<void> {
  const cursors = await getCursors(db);

  const body: SyncPullRequest = { cursors };
  const response = await fetch("/api/sync/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Pull failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as SyncPullResponse;

  for (const table of tables) {
    const raw = data[table.name];
    if (!Array.isArray(raw)) continue;
    await mergeRows(db, table, raw as Record<string, unknown>[]);
  }

  for (const [tableName, cursor] of Object.entries(data.newCursors)) {
    await setCursor(db, tableName, cursor);
  }

  window.dispatchEvent(new CustomEvent(SYNC_COMPLETE_EVENT));
}
