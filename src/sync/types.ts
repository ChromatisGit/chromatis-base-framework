// Conflict resolution strategy for a synced table.
//
// "merge"       — If the local row is pending_push and the server has a newer
//                 version, mark the local row as "conflict" so the app can
//                 surface it in the UI. Local pending changes are preserved.
// "server_wins" — Server row always overwrites the local row, even if the
//                 client has unsent changes. Use for tables where the server
//                 is the sole writer (e.g. prompts, categories).
export type SyncMode = "merge" | "server_wins";

// Per-table sync configuration registered by the consuming app.
export interface SyncTableConfig {
  /** Must match the Postgres table name exactly. */
  name: string;
  mode: SyncMode;
  /**
   * Optional transform applied to each row received from the server before
   * it is written to SQLite. Use to normalize JSON payloads, coerce dates, etc.
   */
  transform?: (row: Record<string, unknown>) => Record<string, unknown>;
}

// Payload sent to POST /api/sync/push.
export type SyncPushPayload = Record<string, unknown[]>;

// Body sent to POST /api/sync/pull.
export interface SyncPullRequest {
  cursors: Record<string, number>;
}

// Body received from POST /api/sync/pull.
export interface SyncPullResponse {
  newCursors: Record<string, number>;
  [table: string]: unknown;
}

// Local sync_queue entry kinds.
export type QueueEntryKind = "push" | "operation";

// Shape of a row in the local sync_queue table.
export interface SyncQueueEntry {
  id: string;
  kind: QueueEntryKind;
  operation_id: string | null;
  retry_count: number;
  next_attempt_at: string;
  created_at: string;
}

// Shape of a row in the local sync_cursors table.
export interface SyncCursor {
  table_name: string;
  cursor: number;
}
