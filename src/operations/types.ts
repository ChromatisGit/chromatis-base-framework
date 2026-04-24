import { z } from "zod";

export const operationKindSchema = z.enum([
  "transcribe_audio",
  "process_prompt",
]);

export const operationStatusSchema = z.enum([
  "running",
  "done",
  "failed",
]);

/**
 * Server-side operation row shape.
 * Cost/usage fields (total_usage, unit, unit_cost) are server-only
 * and intentionally omitted from client-facing schemas.
 */
export const operationSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  kind: operationKindSchema,
  status: operationStatusSchema,
  prompt_id: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  error: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  server_version: z.number().int().nonnegative(),
});

export const executeTranscribeAudioInputSchema = z.object({
  operation_id: z.string(),
  kind: z.literal("transcribe_audio"),
  idempotency_key: z.string().min(1),
  mime_type: z.string().min(1),
});

export const executeProcessPromptInputSchema = z.object({
  operation_id: z.string(),
  kind: z.literal("process_prompt"),
  prompt_id: z.string(),
  raw_text: z.string().min(1),
  source_type: z.enum(["client", "email"]),
  idempotency_key: z.string().min(1),
});

export const executeOperationInputSchema = z.discriminatedUnion("kind", [
  executeTranscribeAudioInputSchema,
  executeProcessPromptInputSchema,
]);

export const executeTranscribeAudioResultSchema = z.object({
  operation_id: z.string(),
  kind: z.literal("transcribe_audio"),
  status: z.enum(["done", "failed"]),
  transcript_text: z.string().nullable(),
  error: z.string().nullable(),
});

export const executeProcessPromptResultSchema = z.object({
  operation_id: z.string(),
  kind: z.literal("process_prompt"),
  status: z.enum(["done", "failed"]),
  created_item_ids: z.array(z.string()),
  error: z.string().nullable(),
});

export const executeOperationResultSchema = z.discriminatedUnion("kind", [
  executeTranscribeAudioResultSchema,
  executeProcessPromptResultSchema,
]);

export const localOperationSchema = z.object({
  id: z.string(),
  kind: operationKindSchema,
  prompt_id: z.string().nullable(),
  audio_blob_id: z.string().nullable(),

  queue_state: z.enum(["queued", "running", "retry_wait", "done", "failed"]),
  retry_count: z.number().int().nonnegative(),
  next_attempt_at: z.string().nullable(),

  error: z.string().nullable(),
  last_transport_error: z.string().nullable(),

  created_at: z.string(),
  updated_at: z.string(),
});

export type Operation = z.infer<typeof operationSchema>;

export type ExecuteTranscribeAudioInput = z.infer<typeof executeTranscribeAudioInputSchema>;
export type ExecuteProcessPromptInput = z.infer<typeof executeProcessPromptInputSchema>;
export type ExecuteOperationInput = z.infer<typeof executeOperationInputSchema>;

export type ExecuteTranscribeAudioResult = z.infer<typeof executeTranscribeAudioResultSchema>;
export type ExecuteProcessPromptResult = z.infer<typeof executeProcessPromptResultSchema>;
export type ExecuteOperationResult = z.infer<typeof executeOperationResultSchema>;

export type LocalOperation = z.infer<typeof localOperationSchema>;
