// SQLite parameterized query. Uses ? positional placeholders (not $1).
export interface SqlQuery {
  text: string;
  params: unknown[];
}

// Tagged template for building parameterized SQLite queries safely.
//
//   const id = "abc";
//   const q = sql`SELECT * FROM items WHERE id = ${id}`;
//   // → { text: "SELECT * FROM items WHERE id = ?", params: ["abc"] }
//
// Never use string concatenation to build queries — always use this tag
// for any value that comes from runtime data.
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlQuery {
  let text = "";
  const params: unknown[] = [];
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      params.push(values[i]);
      text += "?";
    }
  }
  return { text, params };
}

// Build a raw query from a plain string (no parameters).
// Only use this for queries with no runtime values (e.g. PRAGMA, DDL).
export function rawSql(text: string): SqlQuery {
  return { text, params: [] };
}

// Escape an identifier (table name, column name) for safe interpolation
// into SQL strings that are NOT parameterized (e.g. inside DDL or when
// the identifier itself is dynamic). This is NOT a substitute for params.
export function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
