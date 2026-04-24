import type { DbSql, SqlFragment, SqlQueryValue } from "./types.js";

function isSqlFragment(value: unknown): value is SqlFragment {
  return typeof value === "object"
    && value !== null
    && "kind" in value
    && (value as SqlFragment).kind === "fragment";
}

function shiftPlaceholders(text: string, offset: number): string {
  if (offset === 0) {
    return text;
  }

  return text.replace(/\$(\d+)/g, (_, rawIndex: string) => `$${Number(rawIndex) + offset}`);
}

function compileQuery(strings: readonly string[], values: readonly SqlQueryValue[]): SqlFragment {
  let text = "";
  const params: unknown[] = [];

  for (let index = 0; index < strings.length; index += 1) {
    text += strings[index];

    if (index >= values.length) {
      continue;
    }

    const value = values[index];
    if (isSqlFragment(value)) {
      text += shiftPlaceholders(value.text, params.length);
      params.push(...value.values);
      continue;
    }

    params.push(value);
    text += `$${params.length}`;
  }

  return {
    kind: "fragment",
    text,
    values: params,
  };
}

function escapeIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: "${identifier}"`);
  }

  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

export function createSqlTag(
  execute: (query: SqlFragment) => Promise<unknown[]>,
): DbSql {
  const sql = ((first: string | TemplateStringsArray, ...rest: SqlQueryValue[]) => {
    if (typeof first === "string") {
      return sql.unsafe(first);
    }

    return execute(compileQuery(first, rest)) as Promise<unknown[]>;
  }) as DbSql;

  sql.unsafe = (identifier: string) => ({
    kind: "fragment",
    text: escapeIdentifier(identifier),
    values: [],
  });

  return sql;
}
