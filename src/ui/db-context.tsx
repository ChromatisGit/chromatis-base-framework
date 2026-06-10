import { createContext, useContext } from "react";
import type { SqliteClient } from "../sqlite/client.js";

const DbContext = createContext<SqliteClient | null>(null);

export function DbProvider({
  children,
  db,
}: {
  children: React.ReactNode;
  db: SqliteClient | null;
}) {
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

export function useDb(): SqliteClient | null {
  return useContext(DbContext);
}
