import type { SqliteClient } from "../../sqlite/client.js";
import type { SyncTableConfig, SyncQueueEntry } from "../types.js";
import { executePush } from "./push.js";

const MAX_RETRIES = 3;
const BACKOFF_MS = [5_000, 30_000, 120_000] as const;

function backoffAt(retryCount: number): string {
  const ms = BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)] ?? 120_000;
  return new Date(Date.now() + ms).toISOString();
}

function now(): string {
  return new Date().toISOString();
}

async function getDueEntries(db: SqliteClient): Promise<SyncQueueEntry[]> {
  return db.query<SyncQueueEntry>({
    text: `SELECT * FROM sync_queue
           WHERE next_attempt_at <= ?
           ORDER BY created_at ASC`,
    params: [now()],
  });
}

async function deleteEntry(db: SqliteClient, id: string): Promise<void> {
  await db.mutate({ text: "DELETE FROM sync_queue WHERE id = ?", params: [id] });
}

async function updateEntry(
  db: SqliteClient,
  entry: SyncQueueEntry,
): Promise<void> {
  await db.mutate({
    text: `UPDATE sync_queue
           SET retry_count = ?, next_attempt_at = ?
           WHERE id = ?`,
    params: [entry.retry_count, entry.next_attempt_at, entry.id],
  });
}

// Hooks for app-level operation handling (transcribe_audio, process_prompt…).
// The framework owns push; the app owns operation execution.
export type DrainHooks = {
  /** Execute one local operation. Return true if done, false to retry. */
  executeOperation?: (
    db: SqliteClient,
    operationId: string,
  ) => Promise<{ done: boolean; error?: string; permanent?: boolean }>;
  /** Called when a push batch permanently fails after all retries. */
  onPushError?: (db: SqliteClient, error: string) => Promise<void>;
  /** Called when an operation permanently fails after all retries. */
  onOperationFailed?: (
    db: SqliteClient,
    operationId: string,
    error: string,
  ) => Promise<void>;
};

export async function drainQueue(
  db: SqliteClient,
  tables: SyncTableConfig[],
  hooks: DrainHooks = {},
): Promise<void> {
  let entries = await getDueEntries(db);

  while (entries.length > 0) {
    const pushEntries = entries.filter((e) => e.kind === "push");
    const opEntries = entries.filter((e) => e.kind === "operation");

    // ── Push batch ─────────────────────────────────────────────────────────
    if (pushEntries.length > 0) {
      try {
        await executePush(db, tables);
        for (const entry of pushEntries) await deleteEntry(db, entry.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Push failed";
        console.error("[sync/drain] push failed", message);

        const exhausted = pushEntries.some((e) => e.retry_count >= MAX_RETRIES);
        if (exhausted) {
          await hooks.onPushError?.(db, message);
          for (const entry of pushEntries) await deleteEntry(db, entry.id);
        } else {
          for (const entry of pushEntries) {
            await updateEntry(db, {
              ...entry,
              retry_count: entry.retry_count + 1,
              next_attempt_at: backoffAt(entry.retry_count),
            });
          }
        }
      }
    }

    // ── Operations ──────────────────────────────────────────────────────────
    for (const entry of opEntries) {
      if (!entry.operation_id || !hooks.executeOperation) {
        await deleteEntry(db, entry.id);
        continue;
      }

      try {
        const result = await hooks.executeOperation(db, entry.operation_id);
        if (result.done) {
          await deleteEntry(db, entry.id);
        } else {
          const permanent = result.permanent ?? false;
          const retries = entry.retry_count;
          if (permanent || retries >= MAX_RETRIES) {
            const msg = result.error ?? "Operation failed";
            await hooks.onOperationFailed?.(db, entry.operation_id, msg);
            await deleteEntry(db, entry.id);
          } else {
            await updateEntry(db, {
              ...entry,
              retry_count: retries + 1,
              next_attempt_at: backoffAt(retries),
            });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Operation error";
        console.error("[sync/drain] operation failed", entry.operation_id, message);
        const retries = entry.retry_count;
        if (retries >= MAX_RETRIES) {
          await hooks.onOperationFailed?.(db, entry.operation_id, message);
          await deleteEntry(db, entry.id);
        } else {
          await updateEntry(db, {
            ...entry,
            retry_count: retries + 1,
            next_attempt_at: backoffAt(retries),
          });
        }
      }
    }

    entries = await getDueEntries(db);
  }
}

// Enqueue a push task (idempotent — deduplicates by kind = 'push' pending).
export async function enqueuePush(db: SqliteClient): Promise<void> {
  const existing = await db.query({
    text: "SELECT id FROM sync_queue WHERE kind = 'push' AND next_attempt_at > ?",
    params: [new Date(Date.now() - 1000).toISOString()],
  });
  if (existing.length > 0) return; // already queued

  const id = crypto.randomUUID();
  await db.mutate({
    text: `INSERT INTO sync_queue (id, kind, operation_id, retry_count, next_attempt_at, created_at)
           VALUES (?, 'push', NULL, 0, ?, ?)`,
    params: [id, now(), now()],
  });
}

// Enqueue an operation task.
export async function enqueueOperation(
  db: SqliteClient,
  operationId: string,
): Promise<void> {
  const id = crypto.randomUUID();
  await db.mutate({
    text: `INSERT INTO sync_queue (id, kind, operation_id, retry_count, next_attempt_at, created_at)
           VALUES (?, 'operation', ?, 0, ?, ?)`,
    params: [id, operationId, now(), now()],
  });
}
