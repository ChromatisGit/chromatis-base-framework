import { createContext, useContext } from "react";

const DbContext = createContext<IDBDatabase | null>(null);

export function DbProvider({
  children,
  db,
}: {
  children: React.ReactNode;
  db: IDBDatabase | null;
}) {
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

export function useDb(): IDBDatabase | null {
  return useContext(DbContext);
}
