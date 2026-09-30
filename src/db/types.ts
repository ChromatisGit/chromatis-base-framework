export interface SqlFragment {
  kind: "fragment";
  text: string;
  values: unknown[];
}

export type SqlQueryValue = SqlFragment | unknown;

export interface DbSql {
  <T extends unknown[] = Array<Record<string, unknown>>>(
    strings: TemplateStringsArray,
    ...values: SqlQueryValue[]
  ): Promise<T>;
  (identifier: string): SqlFragment;
  unsafe(identifier: string): SqlFragment;
}

export type DatabaseUser = Readonly<{ id: string }>;

export interface MigrationAsset {
  module: string;
  version: string;
  description: string;
  sql: string;
}

export interface DbAdapter {
  withAnonTx<T>(fn: (sql: DbSql) => Promise<T>): Promise<T>;
  withUserTx<T>(user: DatabaseUser, fn: (sql: DbSql) => Promise<T>): Promise<T>;
  runSetup(options: AdapterSetupOptions): Promise<void>;
}

export type MigrationMode = "apply" | "check";

export interface AdapterSetupOptions {
  mode: MigrationMode;
  connectionKey: string;
  migrations: readonly MigrationAsset[];
}
