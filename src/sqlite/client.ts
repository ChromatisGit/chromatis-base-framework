import type { WorkerRequest, WorkerReply, SqliteMigration } from "./types.js";
import type { SqlQuery } from "./sql.js";

// Client-side proxy to the SQLite Worker.
// All methods are async — they send a message and wait for the reply.
export interface SqliteClient {
  /** Run a SELECT (or any read-only statement). Returns typed rows. */
  query<T = Record<string, unknown>>(q: SqlQuery): Promise<T[]>;
  /** Run an INSERT / UPDATE / DELETE. Returns number of changed rows. */
  mutate(q: SqlQuery): Promise<number>;
  /**
   * Run multiple statements atomically.
   * Wrap writes that must succeed together (e.g. update row + enqueue push).
   */
  transaction(queries: SqlQuery[]): Promise<void>;
}

// Options passed to createSqliteClient.
export interface SqliteClientOptions {
  /** Database file name (without extension). */
  name: string;
  /** Ordered migration list. Run on startup if user_version is behind. */
  migrations: SqliteMigration[];
}

// Monotonically increasing request ID — simple and collision-free per tab.
let _nextId = 0;
function nextId(): string {
  return String(++_nextId);
}

function send(worker: Worker, msg: WorkerRequest): Promise<WorkerReply> {
  return new Promise((resolve, reject) => {
    const id = msg.id;

    function onMessage(event: MessageEvent<WorkerReply>) {
      if (event.data.id !== id) return;
      worker.removeEventListener("message", onMessage);
      resolve(event.data);
    }

    worker.addEventListener("message", onMessage);
    worker.postMessage(msg);

    // Safety timeout — avoids hanging promises if the worker dies.
    setTimeout(() => {
      worker.removeEventListener("message", onMessage);
      reject(new Error(`[sqlite] Request ${id} timed out`));
    }, 30_000);
  });
}

// Module-level cache: keyed by DB name.
// Prevents duplicate workers when React StrictMode double-invokes effects.
const _instances = new Map<string, Promise<SqliteClient>>();

// Create a SqliteClient backed by a dedicated Worker running SQLite via OPFS.
// Each tab gets its own worker instance. The server is the source of truth,
// so per-tab workers sync independently without cross-tab write conflicts.
export function createSqliteClient(options: SqliteClientOptions): Promise<SqliteClient> {
  const cached = _instances.get(options.name);
  if (cached) return cached;

  const promise = _createClient(options).catch((err) => {
    _instances.delete(options.name); // allow retry on failure
    throw err;
  });
  _instances.set(options.name, promise);
  return promise;
}

async function _createClient(
  options: SqliteClientOptions,
): Promise<SqliteClient> {
  // Vite only recognizes the worker-bundling pattern when `new URL(...)` is
  // written inline as the argument to `new Worker(...)` — assigning it to a
  // variable first defeats Vite's static detection, and it silently falls
  // back to copying this file as a raw, untranspiled .ts asset (which Cloudflare
  // then serves with Content-Type: video/mp2t, since that's the standard MIME
  // mapping for the .ts extension — module scripts fail strict MIME checks).
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "sqlite" });

  // Initialize the database (migrations run on first connect only).
  const initReply = await send(worker, {
    id: nextId(),
    type: "init",
    name: options.name,
    migrations: options.migrations,
  });

  if ("error" in initReply) {
    throw new Error(`[sqlite] Init failed: ${initReply.error}`);
  }

  function assertSuccess(reply: WorkerReply): void {
    if ("error" in reply) throw new Error(`[sqlite] ${reply.error}`);
  }

  return {
    async query<T = Record<string, unknown>>(q: SqlQuery): Promise<T[]> {
      const reply = await send(worker, { id: nextId(), type: "query", sql: q.text, params: q.params });
      assertSuccess(reply);
      return ("rows" in reply ? reply.rows : []) as T[];
    },

    async mutate(q: SqlQuery): Promise<number> {
      const reply = await send(worker, { id: nextId(), type: "mutate", sql: q.text, params: q.params });
      assertSuccess(reply);
      return "changes" in reply ? reply.changes : 0;
    },

    async transaction(queries: SqlQuery[]): Promise<void> {
      const reply = await send(worker, {
        id: nextId(),
        type: "transaction",
        queries: queries.map((q) => ({ sql: q.text, params: q.params })),
      });
      assertSuccess(reply);
    },
  };
}
