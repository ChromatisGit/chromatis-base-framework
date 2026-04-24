import { drainQueue, type DrainQueueHooks } from "./drainQueue.js";

let _db: IDBDatabase | null = null;
let _hooks: DrainQueueHooks | null = null;
let _drainTimeout: ReturnType<typeof setTimeout> | null = null;

export function initScheduler(db: IDBDatabase, hooks: DrainQueueHooks): void {
  _db = db;
  _hooks = hooks;

  window.addEventListener("online", triggerDrain);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") triggerDrain();
  });

  triggerDrain();
}

export function requestDrain(): void {
  triggerDrain();
}

function triggerDrain(): void {
  if (!_db || !_hooks) return;
  if (_drainTimeout) clearTimeout(_drainTimeout);
  _drainTimeout = setTimeout(() => {
    _drainTimeout = null;
    if (_db && _hooks) {
      drainQueue(_db, _hooks).catch(() => {});
    }
  }, 300);
}
