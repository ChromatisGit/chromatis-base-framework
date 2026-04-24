export type DbOrTx = IDBDatabase | IDBTransaction;

export function getObjectStore(
  dbOrTx: DbOrTx,
  name: string,
  mode: IDBTransactionMode = "readonly",
): IDBObjectStore {
  return dbOrTx instanceof IDBTransaction
    ? dbOrTx.objectStore(name)
    : dbOrTx.transaction(name, mode).objectStore(name);
}

export function runTransaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);

    let result: T;
    let fnError: unknown;
    let callbackSettled = false;
    let transactionFinished = false;
    let settled = false;

    function resolveOnce(value: T) {
      if (settled) return;
      settled = true;
      resolve(value);
    }

    function rejectOnce(error: unknown) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    tx.oncomplete = () => {
      transactionFinished = true;
      if (callbackSettled) resolveOnce(result);
    };
    tx.onerror = () => {
      transactionFinished = true;
      rejectOnce(tx.error ?? new Error("Transaction failed"));
    };
    tx.onabort = () => {
      transactionFinished = true;
      rejectOnce(fnError ?? tx.error ?? new Error("Transaction aborted"));
    };

    Promise.resolve()
      .then(() => fn(tx))
      .then(
        (value) => {
          result = value;
          callbackSettled = true;
          if (transactionFinished) resolveOnce(value);
        },
        (error) => {
          fnError = error;
          callbackSettled = true;

          if (transactionFinished) {
            rejectOnce(error);
            return;
          }

          try {
            tx.abort();
          } catch {
            rejectOnce(error);
          }
        },
      );
  });
}

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
