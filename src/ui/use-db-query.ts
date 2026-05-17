import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useDb } from "./db-context.js";

export const SYNC_COMPLETE_EVENT = "platform:synced";

interface DbQueryState<T> {
  db: IDBDatabase | null;
  data: T | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useDbQuery<T>(
  load: (db: IDBDatabase) => Promise<T>,
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
        nextError instanceof Error ? nextError : new Error("Failed to load data"),
      );
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    if (!db) return;
    void runLoad();
  }, [db, runLoad, ...deps]);

  useEffect(() => {
    function handleSync() {
      void runLoad();
    }
    window.addEventListener(SYNC_COMPLETE_EVENT, handleSync);
    return () => window.removeEventListener(SYNC_COMPLETE_EVENT, handleSync);
  }, [runLoad]);

  return { db, data, loading, error, refresh: runLoad };
}
