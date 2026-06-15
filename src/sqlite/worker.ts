// Dedicated Worker entry point for SQLite.
//
// Each tab gets its own worker instance. FileSystemSyncAccessHandle (used by
// the OPFS SAH Pool VFS) is only available in dedicated workers, not in
// SharedWorkers — that's why we use Worker instead of SharedWorker.
//
// All SQLite APIs used here are synchronous — valid in a Worker context.
/// <reference lib="webworker" />

import type { WorkerRequest, WorkerReply, SqliteMigration } from "./types.js";

// @sqlite.org/sqlite-wasm does not ship TS declarations; use dynamic import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sqlite3 = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OO1DB = any;

let db: OO1DB | null = null;
let initPromise: Promise<void> | null = null;

// ─── SQLite helpers ──────────────────────────────────────────────────────────

function runQuery(
  database: OO1DB,
  text: string,
  params: unknown[],
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  database.exec({
    sql: text,
    bind: params,
    rowMode: "object",
    callback: (row: Record<string, unknown>) => rows.push(row),
  });
  return rows;
}

function runMutate(
  database: OO1DB,
  text: string,
  params: unknown[],
): number {
  database.exec({ sql: text, bind: params });
  return database.changes();
}

function runTransaction(
  database: OO1DB,
  queries: Array<{ sql: string; params: unknown[] }>,
): void {
  database.exec("BEGIN");
  try {
    for (const q of queries) {
      database.exec({ sql: q.sql, bind: q.params });
    }
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
}

// ─── Migration runner ────────────────────────────────────────────────────────

function applyMigrations(database: OO1DB, migrations: SqliteMigration[]): void {
  // user_version is a SQLite-managed integer, perfect for migration tracking.
  const [{ user_version }] = runQuery(database, "PRAGMA user_version", []) as
    [{ user_version: number }];

  const pending = migrations
    .filter((m) => m.version > user_version)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    database.exec("BEGIN");
    try {
      database.exec(migration.sql);
      // PRAGMA inside a transaction must use exec directly (not parameterized).
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    }
  }
}

// ─── Database initialization ─────────────────────────────────────────────────

async function initDB(name: string, migrations: SqliteMigration[]): Promise<void> {
  // Dynamic import avoids bundling the WASM module into the main chunk.
  // Vite resolves this correctly for Worker contexts.
  const { default: sqlite3InitModule } = await import("@sqlite.org/sqlite-wasm");

  const sqlite3: Sqlite3 = await sqlite3InitModule({
    print: () => {},
    printErr: (msg: string) => console.error("[sqlite]", msg),
  });

  // Prefer OPFS SAH pool — synchronous, persistent. Requires dedicated worker
  // (FileSystemSyncAccessHandle not available in SharedWorkers).
  //
  // Use a Web Lock to prevent cross-tab conflicts: only one tab at a time can
  // hold the SAH pool files open. If another tab already has the lock we skip
  // straight to the in-memory fallback — data syncs from the server anyway.
  // The lock is released automatically when the worker terminates.
  if (sqlite3.installOpfsSAHPoolVfs && typeof navigator !== "undefined" && "locks" in navigator) {
    const opfsReady = await new Promise<boolean>((resolve) => {
      navigator.locks
        .request(`sqlite-opfs-${name}`, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          // Retry a few times: a terminating worker may still hold OPFS
          // file handles briefly after its Web Lock is released.
          let initialized = false;
          for (let attempt = 0; attempt < 4 && !initialized; attempt++) {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
            try {
              const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
                name: "opfs-sahpool",
                directory: "/",
              });
              db = new poolUtil.OpfsSAHPoolDb(`/${name}.sqlite3`);
              initialized = true;
            } catch {
              // Stale handle — will retry.
            }
          }
          if (!initialized) {
            resolve(false);
            return;
          }
          resolve(true);
          // Hold the lock for the worker's lifetime so other tabs
          // don't try to open the same OPFS files while we have them.
          await new Promise<void>(() => {});
        })
        .catch(() => resolve(false));
    });

    if (opfsReady) {
      applyMigrations(db, migrations);
      return;
    }
  } else if (sqlite3.installOpfsSAHPoolVfs) {
    // Web Locks not available — try SAH pool directly (single-tab scenario).
    try {
      const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
        name: "opfs-sahpool",
        directory: "/",
      });
      db = new poolUtil.OpfsSAHPoolDb(`/${name}.sqlite3`);
      applyMigrations(db, migrations);
      return;
    } catch {
      // Fall through to in-memory.
    }
  }

  if (sqlite3.oo1?.OpfsDb) {
    // Standard OPFS (requires COOP/COEP headers).
    try {
      db = new sqlite3.oo1.OpfsDb(`/${name}.sqlite3`);
      applyMigrations(db, migrations);
      return;
    } catch {
      // Fall through to in-memory.
    }
  }

  // In-memory fallback: OPFS unavailable or in use by another tab.
  // Data syncs from the server on every load, so this is safe.
  console.warn("[sqlite] Using in-memory database — OPFS unavailable or locked by another tab");
  db = new sqlite3.oo1.DB(":memory:");
  applyMigrations(db, migrations);
}

// ─── Dedicated Worker message handler ───────────────────────────────────────

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === "init") {
    try {
      if (!initPromise) {
        initPromise = initDB(msg.name, msg.migrations);
      }
      await initPromise;
      self.postMessage({ id: msg.id, rows: [] } satisfies WorkerReply);
    } catch (err) {
      self.postMessage({
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      } satisfies WorkerReply);
    }
    return;
  }

  if (!db) {
    if (initPromise) {
      try {
        await initPromise;
      } catch {
        self.postMessage({ id: msg.id, error: "Database failed to initialize" } satisfies WorkerReply);
        return;
      }
    } else {
      self.postMessage({ id: msg.id, error: "Database not initialized — send init first" } satisfies WorkerReply);
      return;
    }
  }

  try {
    let reply: WorkerReply;
    switch (msg.type) {
      case "query":
        reply = { id: msg.id, rows: runQuery(db, msg.sql, msg.params) };
        break;
      case "mutate":
        reply = { id: msg.id, changes: runMutate(db, msg.sql, msg.params) };
        break;
      case "transaction":
        runTransaction(db, msg.queries);
        reply = { id: msg.id, changes: 0 };
        break;
    }
    self.postMessage(reply);
  } catch (err) {
    self.postMessage({
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerReply);
  }
});
