import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useDb } from "./db-context.js";
import type { SqliteClient } from "../sqlite/client.js";

export { SYNC_COMPLETE_EVENT } from "../sync/.client/pull.js";

interface DbQueryState<T> {
  db: SqliteClient | null;
  data: T | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

// React hook for reading data from the local SQLite database.
//
// Automatically re-runs when:
//   - The database becomes available (on mount)
//   - Any value in `deps` changes
//   - A SYNC_COMPLETE_EVENT fires (server pulled new data)
//
// Usage:
//   const { data: items } = useDbQuery(
//     (db) => db.query<LocalItem>(sql`SELECT * FROM items WHERE deleted_at IS NULL`),
//   );
export function useDbQuery<T>(
  load: (db: SqliteClient) => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
): DbQueryState<T> {
  const db = useDb();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const genRef = useRef(0);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const runLoad = useCallback(async () => {
    if (!db) return;
    const gen = ++genRef.current;
    setLoading(true);
    try {
      const next = await loadRef.current(db);
      if (gen !== genRef.current) return;
      startTransition(() => {
        setData(next);
        setError(null);
      });
    } catch (nextError) {
      if (gen !== genRef.current) return;
      setError(
        nextError instanceof Error
          ? nextError
          : new Error("Failed to load data"),
      );
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [db]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (db) void runLoad(); }, [db, runLoad, ...deps]);

  useEffect(() => {
    window.addEventListener("platform:synced", runLoad);
    return () => window.removeEventListener("platform:synced", runLoad);
  }, [runLoad]);

  return { db, data, loading, error, refresh: runLoad };
}
