import { putLocalOperation } from "@platform/sync/.client/local-db/repos/localOperationRepo.js";
import { enqueueSyncEntry } from "@platform/sync/.client/local-db/repos/syncQueueRepo.js";
import type { LocalOperation } from "@platform/operations/types.js";

export async function createLocalOperation(
  db: IDBDatabase,
  kind: "transcribe_audio" | "process_prompt",
  promptId: string | null,
  audioBlobId?: string,
): Promise<LocalOperation> {
  const nowStr = new Date().toISOString();
  const op: LocalOperation = {
    id: crypto.randomUUID(),
    kind,
    prompt_id: promptId,
    audio_blob_id: audioBlobId ?? null,
    queue_state: "queued",
    retry_count: 0,
    next_attempt_at: nowStr,
    error: null,
    last_transport_error: null,
    created_at: nowStr,
    updated_at: nowStr,
  };
  await putLocalOperation(db, op);
  await enqueueSyncEntry(db, {
    id: crypto.randomUUID(),
    kind: "operation",
    operation_id: op.id,
    next_attempt_at: nowStr,
    retry_count: 0,
    created_at: nowStr,
  });
  return op;
}
