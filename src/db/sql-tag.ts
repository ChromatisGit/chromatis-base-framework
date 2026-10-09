import type { DbSql, SqlFragment, SqlQueryValue } from "./types.js";

/**
 * Only fragments built by this module count as SQL syntax. A value that merely
 * looks like a fragment (for example parsed from a request body) is an ordinary
 * parameter, so user-controlled data can never become SQL syntax.
 */
const trustedFragments = new WeakSet<object>();

function trusted(fragment: SqlFragment): SqlFragment {
  trustedFragments.add(fragment);
  return fragment;
}

function isSqlFragment(value: unknown): value is SqlFragment {
  return (
    typeof value === "object" && value !== null && trustedFragments.has(value)
  );
}

/**
 * Chromatis identity and database-role context belongs to the framework.
 * Query text that tries to set or reset it is rejected before it is sent.
 */
const IDENTITY_MANIPULATION: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bset_config\b/i, "set_config()"],
  [
    /\bset\s+(?:local\s+|session\s+)?(?:role|session\s+authorization)\b/i,
    "SET ROLE / SESSION AUTHORIZATION",
  ],
  [/\bset\s+(?:local\s+|session\s+)?"?app\./i, "SET app.*"],
  [/\breset\s+(?:role|session\s+authorization|all|"?app\.)/i, "RESET"],
  [/\bdiscard\s+all\b/i, "DISCARD ALL"],
];

function assertAllowedSql(strings: readonly string[]): void {
  const text = strings.join(" ");
  for (const [pattern, name] of IDENTITY_MANIPULATION) {
    if (pattern.test(text)) {
      throw new Error(
        `[db] ${name} is reserved for the framework and cannot appear in application SQL.`,
      );
    }
  }
}

function shiftPlaceholders(text: string, offset: number): string {
  if (offset === 0) {
    return text;
  }

  return text.replace(
    /\$(\d+)/g,
    (_, rawIndex: string) => `$${Number(rawIndex) + offset}`,
  );
}

function compileQuery(
  strings: readonly string[],
  values: readonly SqlQueryValue[],
): SqlFragment {
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

  return trusted({
    kind: "fragment",
    text,
    values: params,
  });
}

function escapeIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: "${identifier}"`);
  }

  return `"${identifier.replace(/"/g, '""')}"`;
}

function isTemplate(value: unknown): value is TemplateStringsArray {
  return (
    Array.isArray(value) && Array.isArray((value as { raw?: unknown }).raw)
  );
}

/**
 * Builds the only query interface application code receives: a tagged
 * template whose interpolated values are always bound parameters. There is no
 * raw-SQL entry point; `identifier()` accepts a plain identifier only.
 */
export function createSqlTag(
  execute: (query: SqlFragment) => Promise<unknown[]>,
): DbSql {
  const sql = ((first: TemplateStringsArray, ...rest: SqlQueryValue[]) => {
    if (!isTemplate(first)) {
      throw new Error(
        "[db] SQL must be written as a tagged template: sql`SELECT ... ${value}`.",
      );
    }
    assertAllowedSql(first);
    return execute(compileQuery(first, rest)) as Promise<unknown[]>;
  }) as DbSql;

  sql.identifier = (identifier: string) =>
    trusted({
      kind: "fragment",
      text: escapeIdentifier(identifier),
      values: [],
    });

  return sql;
}
