import type { SqliteClient } from "../../sqlite/client.js";
import type { SyncTableConfig } from "../types.js";
import { drainQueue, type DrainHooks } from "./drain.js";
import { executePull } from "./pull.js";

const DEBOUNCE_MS = 300;

let _client: SqliteClient | null = null;
let _tables: SyncTableConfig[] = [];
let _hooks: DrainHooks = {};
let _drainTimeout: ReturnType<typeof setTimeout> | null = null;
let _running = false;

async function runCycle(): Promise<void> {
  if (_running || !_client) return;
  _running = true;
  try {
    await drainQueue(_client, _tables, _hooks);
    await executePull(_client, _tables);
  } catch (err) {
    console.error("[sync/scheduler] cycle error", err);
  } finally {
    _running = false;
  }
}

function triggerDrain(): void {
  if (_drainTimeout) clearTimeout(_drainTimeout);
  _drainTimeout = setTimeout(() => {
    _drainTimeout = null;
    void runCycle();
  }, DEBOUNCE_MS);
}

export function initSyncScheduler(
  client: SqliteClient,
  tables: SyncTableConfig[],
  hooks: DrainHooks = {},
): void {
  _client = client;
  _tables = tables;
  _hooks = hooks;

  window.addEventListener("online", triggerDrain);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") triggerDrain();
  });

  triggerDrain();
}

// Call after any write that sets sync_state = 'pending_push'.
export function requestSync(): void {
  triggerDrain();
}
