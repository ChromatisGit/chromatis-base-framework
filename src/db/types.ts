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

export interface DbAdapter {
  getDb(): DbSql;
  withUserContext<T>(userId: string, fn: () => Promise<T>): Promise<T>;
}
