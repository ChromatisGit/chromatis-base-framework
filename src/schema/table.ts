import type { ColDef, Target, TsType } from "./column.js";
import { generatePostgresDDL } from "./generate/postgres.js";
import { generateSQLiteDDL } from "./generate/sqlite.js";

// Derive the TypeScript type for a single column.
type ColTs<C extends ColDef> =
  C["_tsType"] extends "string"
    ? C["isNullable"] extends true
      ? string | null
      : string
    : C["_tsType"] extends "number"
      ? C["isNullable"] extends true
        ? number | null
        : number
      : C["_tsType"] extends "boolean"
        ? C["isNullable"] extends true
          ? boolean | null
          : boolean
        : C["isNullable"] extends true
          ? unknown | null
          : unknown;

// Row type for Postgres (shared + serverOnly columns).
export type PgRow<T extends Record<string, ColDef>> = {
  [K in keyof T as T[K]["target"] extends "clientOnly" ? never : K]: ColTs<T[K]>;
};

// Row type for SQLite (shared + clientOnly columns).
export type SlRow<T extends Record<string, ColDef>> = {
  [K in keyof T as T[K]["target"] extends "serverOnly" ? never : K]: ColTs<T[K]>;
};

// A table definition. Generic over its column map so PgRow/SlRow inference
// can see the individual column types.
export interface TableDef<T extends Record<string, ColDef<boolean, Target, TsType>>> {
  readonly name: string;
  readonly columns: T;
  /** Postgres CREATE TABLE DDL (shared + serverOnly columns). */
  postgresDDL(): string;
  /** SQLite CREATE TABLE DDL (shared + clientOnly columns). */
  sqliteDDL(): string;
}

// Usage:
//   const items = defineTable("items", { id: col.uuid().primaryKey(), ... });
//   type LocalItem   = SlRow<typeof items["columns"]>;
//   type ServerItem  = PgRow<typeof items["columns"]>;
export function defineTable<T extends Record<string, ColDef<boolean, Target, TsType>>>(
  name: string,
  columns: T,
): TableDef<T> {
  return {
    name,
    columns,
    postgresDDL: () => generatePostgresDDL(name, columns),
    sqliteDDL: () => generateSQLiteDDL(name, columns),
  };
}

// Client-only table (SQLite only, never synced to Postgres).
// All columns default to "shared" target; no Postgres DDL is generated.
// Used for infrastructure tables: sync_queue, sync_cursors, local_operations.
export function defineClientTable<T extends Record<string, ColDef<boolean, Target, TsType>>>(
  name: string,
  columns: T,
): Omit<TableDef<T>, "postgresDDL"> & { sqliteDDL(): string } {
  return {
    name,
    columns,
    sqliteDDL: () => generateSQLiteDDL(name, columns),
  };
}
