import type { ColDef } from "../column.js";

function colDDL(name: string, col: ColDef): string {
  const parts: string[] = [`  ${name}`, col.sqliteType];
  if (col.isPrimaryKey) parts.push("PRIMARY KEY");
  if (!col.isNullable && !col.isPrimaryKey) parts.push("NOT NULL");
  // SQLite CREATE TABLE does not allow function-call defaults (e.g. NOW()).
  // Only emit DEFAULT for literals and parenthesised constant expressions.
  if (col.defaultValue !== undefined && !/\w\(/.test(col.defaultValue)) {
    parts.push(`DEFAULT ${col.defaultValue}`);
  }
  return parts.join(" ");
}

export function generateSQLiteDDL(
  tableName: string,
  columns: Record<string, ColDef>,
): string {
  const cols = Object.entries(columns)
    .filter(([, c]) => c.target !== "serverOnly")
    .map(([name, c]) => colDDL(name, c));

  return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n${cols.join(",\n")}\n);`;
}
