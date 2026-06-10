// Offline-first SQLite layer. Import in apps that use local persistence.
//
// Setup (app/entry.client.tsx):
//   import { createSqliteClient, DbProvider, initSyncScheduler } from "@chromatis/base/offline";
//   import { MIGRATIONS } from "@core/sqlite/migrations";
//   import { SYNC_TABLES } from "@core/.client/syncTables";
//
//   const db = await createSqliteClient({ name: "myapp", migrations: MIGRATIONS });
//   initSyncScheduler(db, SYNC_TABLES, hooks);
//   // render <DbProvider db={db}>...</DbProvider>

export { createSqliteClient } from "./sqlite/client.js";
export type { SqliteClient, SqliteClientOptions } from "./sqlite/client.js";
export type { SqliteMigration } from "./sqlite/types.js";
export { sql, rawSql, ident } from "./sqlite/sql.js";
export type { SqlQuery } from "./sqlite/sql.js";

export { DbProvider, useDb } from "./ui/db-context.js";
export { useDbQuery, SYNC_COMPLETE_EVENT } from "./ui/use-db-query.js";

export { initSyncScheduler, requestSync } from "./sync/.client/scheduler.js";
export { enqueuePush, enqueueOperation } from "./sync/.client/drain.js";
export type { SyncTableConfig, SyncMode } from "./sync/types.js";
