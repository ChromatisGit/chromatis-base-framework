import {
  getDueEntries,
  deleteSyncEntry,
  updateSyncEntry,
} from "./local-db/repos/syncQueueRepo.js";
import { getLocalOperation, putLocalOperation } from "./local-db/repos/localOperationRepo.js";
import type { ExecuteOperationResult, LocalOperation } from "@platform/operations/types.js";

function logDebug(message: string, details?: unknown) {
  console.debug("[platform/queue]", message, details ?? "");
}

function logError(message: string, error: unknown) {
  console.error("[platform/queue]", message, error);
}

const MAX_RETRIES = 3;
const BACKOFF_MS = [5_000, 30_000, 120_000];

function backoffAt(retryCount: number): string {
  const ms = BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)];
  return new Date(Date.now() + ms).toISOString();
}

function now(): string {
  return new Date().toISOString();
}

export type DrainQueueHooks = {
  push: (db: IDBDatabase) => Promise<void>;
  onPushError: (db: IDBDatabase, error: string) => Promise<void>;
  executeOperation: (db: IDBDatabase, op: LocalOperation) => Promise<ExecuteOperationResult>;
  onTranscribeSuccess: (db: IDBDatabase, opId: string, transcript: string) => Promise<void>;
  onProcessPromptSuccess: (db: IDBDatabase, opId: string, createdItemIds: string[]) => Promise<void>;
  onOperationFailed: (db: IDBDatabase, op: LocalOperation, error: string) => Promise<void>;
};

export async function drainQueue(db: IDBDatabase, hooks: DrainQueueHooks): Promise<void> {
  let entries = await getDueEntries(db);

  while (entries.length > 0) {
    logDebug("drainQueue iteration", {
      total: entries.length,
      push: entries.filter((e) => e.kind === "push").length,
      operation: entries.filter((e) => e.kind === "operation").length,
    });

    const pushEntries = entries.filter((e) => e.kind === "push");
    const operationEntries = entries.filter((e) => e.kind === "operation");

    if (pushEntries.length > 0) {
      try {
        logDebug("executing push batch", { count: pushEntries.length });
        await hooks.push(db);
        for (const entry of pushEntries) await deleteSyncEntry(db, entry.id);
        logDebug("push batch completed", { count: pushEntries.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Push failed";
        logError("push batch failed", error);
        const exhausted = pushEntries.some((e) => e.retry_count >= MAX_RETRIES);
        if (exhausted) {
          await hooks.onPushError(db, message);
          for (const entry of pushEntries) await deleteSyncEntry(db, entry.id);
        } else {
          for (const entry of pushEntries) {
            await updateSyncEntry(db, {
              ...entry,
              retry_count: entry.retry_count + 1,
              next_attempt_at: backoffAt(entry.retry_count),
            });
          }
        }
      }
    }

    for (const entry of operationEntries) {
      if (!entry.operation_id) {
        await deleteSyncEntry(db, entry.id);
        continue;
      }

      const operation = await getLocalOperation(db, entry.operation_id);
      if (!operation) {
        await deleteSyncEntry(db, entry.id);
        continue;
      }

      try {
        logDebug("executing operation", {
          queueEntryId: entry.id,
          operationId: operation.id,
          kind: operation.kind,
        });
        await putLocalOperation(db, { ...operation, queue_state: "running", updated_at: now() });

        const result = await hooks.executeOperation(db, operation);

        if (result.kind === "transcribe_audio") {
          if (result.status === "done" && result.transcript_text) {
            await hooks.onTranscribeSuccess(db, operation.id, result.transcript_text);
            await deleteSyncEntry(db, entry.id);
            await putLocalOperation(db, { ...operation, queue_state: "done", error: null, updated_at: now() });
          } else {
            throw new Error(result.error ?? "Transcription returned no text");
          }
        } else if (result.kind === "process_prompt") {
          if (result.status === "done") {
            await hooks.onProcessPromptSuccess(db, operation.id, result.created_item_ids);
            await deleteSyncEntry(db, entry.id);
            await putLocalOperation(db, { ...operation, queue_state: "done", error: null, updated_at: now() });
          } else {
            throw new Error(result.error ?? "Processing failed");
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Operation failed";
        logError("operation failed", { operationId: operation.id, kind: operation.kind, message });
        const retries = entry.retry_count;

        if (retries >= MAX_RETRIES) {
          await putLocalOperation(db, {
            ...operation,
            queue_state: "failed",
            error: message,
            last_transport_error: message,
            updated_at: now(),
          });
          await deleteSyncEntry(db, entry.id);
          await hooks.onOperationFailed(db, operation, message);
        } else {
          await putLocalOperation(db, {
            ...operation,
            queue_state: "retry_wait",
            last_transport_error: message,
            updated_at: now(),
          });
          await updateSyncEntry(db, {
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
