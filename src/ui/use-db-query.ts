import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { useDb } from "./db-context.js";

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

  const runLoad = useEffectEvent(async () => {
    if (!db) return;
    const gen = ++genRef.current;
    setLoading(true);
    try {
      const next = await load(db);
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
  });

  useEffect(() => {
    if (!db) return;
    void runLoad();
  }, [db, ...deps]);

  useEffect(() => {
    function handleSync() {
      void runLoad();
    }
    window.addEventListener("desk:synced", handleSync);
    return () => window.removeEventListener("desk:synced", handleSync);
  }, []);

  return { db, data, loading, error, refresh: runLoad };
}
