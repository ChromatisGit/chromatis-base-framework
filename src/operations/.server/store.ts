import { getDb } from "@platform/db/client.js";
import type { Operation } from "@platform/operations/types.js";

export async function createOperation(
  userId: string,
  kind: "transcribe_audio" | "process_prompt",
  promptId: string | null,
): Promise<Operation> {
  const sql = getDb();
  const rows = await sql<Operation[]>`
    INSERT INTO operations (user_id, kind, prompt_id, status)
    VALUES (${userId}, ${kind}, ${promptId}, 'running')
    RETURNING *
  `;
  return rows[0];
}

export async function completeOperation(
  id: string,
  result: {
    provider: string;
    model: string;
    total_usage: number;
    unit: "token" | "second";
    unit_cost: number | null;
  },
): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE operations SET
      status = 'done',
      provider = ${result.provider},
      model = ${result.model},
      total_usage = ${result.total_usage},
      unit = ${result.unit},
      unit_cost = ${result.unit_cost}
    WHERE id = ${id}
  `;
}

export async function failOperation(id: string, error: string): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE operations SET status = 'failed', error = ${error} WHERE id = ${id}
  `;
}
