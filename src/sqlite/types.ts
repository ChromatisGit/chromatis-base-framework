// SQLite migration bundle — one entry per schema version.
// Version 0 → 1 creates the baseline schema.
// Later versions add incremental DDL (ALTER TABLE, CREATE TABLE, etc.).
export interface SqliteMigration {
  version: number;
  sql: string;
}

// Worker message types (client → worker).
export type WorkerRequest =
  | {
      id: string;
      type: "init";
      name: string;
      migrations: SqliteMigration[];
    }
  | {
      id: string;
      type: "query";
      sql: string;
      params: unknown[];
    }
  | {
      id: string;
      type: "mutate";
      sql: string;
      params: unknown[];
    }
  | {
      id: string;
      type: "transaction";
      queries: Array<{ sql: string; params: unknown[] }>;
    };

// Worker reply types (worker → client).
export type WorkerReply =
  | { id: string; rows: Record<string, unknown>[] }
  | { id: string; changes: number }
  | { id: string; error: string };

export function isErrorReply(r: WorkerReply): r is { id: string; error: string } {
  return "error" in r;
}
