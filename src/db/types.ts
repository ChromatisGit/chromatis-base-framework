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

export type UserCtx = {
  id: string;
  role?: string;
  groupKey?: string | null;
};

export interface MigrationAsset {
  version: string;
  description: string;
  sql: string;
}

export interface SeedAsset {
  name: string;
  sql: string;
}

export interface DbAdapter {
  withAnonTx<T>(fn: (sql: DbSql) => Promise<T>): Promise<T>;
  withUserTx<T>(user: UserCtx, fn: (sql: DbSql) => Promise<T>): Promise<T>;
  runSetup(options: AdapterSetupOptions): Promise<void>;
}

export interface AdapterSetupOptions {
  autoApply: boolean;
  connectionKey: string;
  migrations: readonly MigrationAsset[];
  seeds: readonly SeedAsset[];
}
