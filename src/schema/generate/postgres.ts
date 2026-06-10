import type { ColDef } from "../column.js";

function colDDL(name: string, col: ColDef): string {
  const parts: string[] = [`  ${name}`, col.pgType];
  if (col.isPrimaryKey) parts.push("PRIMARY KEY");
  if (!col.isNullable && !col.isPrimaryKey) parts.push("NOT NULL");
  if (col.defaultValue !== undefined) parts.push(`DEFAULT ${col.defaultValue}`);
  return parts.join(" ");
}

export function generatePostgresDDL(
  tableName: string,
  columns: Record<string, ColDef>,
): string {
  const cols = Object.entries(columns)
    .filter(([, c]) => c.target !== "clientOnly")
    .map(([name, c]) => colDDL(name, c));

  return `CREATE TABLE IF NOT EXISTS ${tableName} (\n${cols.join(",\n")}\n);`;
}
