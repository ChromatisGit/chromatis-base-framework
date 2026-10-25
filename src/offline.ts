/**
 * The page's side of the service worker (service-worker.js): it registers
 * it, activates a waiting version when the app starts, and asks for a new
 * version while the page stays open, without ever reloading an open page.
 */
import { DATA_CACHE, SERVICE_WORKER_PATH } from "./data-protocol.js";

/** How often an open page asks the server for a new version, plus up to as much again. */
const UPDATE_EVERY_MS = 60 * 60 * 1000;
/** How long a start waits for a waiting version to take over before it goes on. */
const ACTIVATION_TIMEOUT_MS = 3000;

const supported = (): boolean =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

/** Resolves once the worker has installed, or failed to (redundant). */
function installed(worker: ServiceWorker): Promise<boolean> {
  if (worker.state !== "installing") {
    return Promise.resolve(worker.state !== "redundant");
  }
  return new Promise((resolve) => {
    worker.addEventListener("statechange", () => {
      if (worker.state !== "installing") {
        resolve(worker.state !== "redundant");
      }
    });
  });
}

/** Lets `worker` take over and reloads once it has; false if it did not in time. */
function takeOver(worker: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ACTIVATION_TIMEOUT_MS);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      clearTimeout(timer);
      window.location.reload();
      resolve(true);
    });
    worker.postMessage({ type: "chromatis:activate" });
  });
}

/**
 * Called before the app renders: a version that finished installing while
 * the app last ran becomes active now, at the start, with one reload from
 * the device. True while that reload is under way.
 */
export async function activateWaitingVersion(): Promise<boolean> {
  if (!supported() || !navigator.serviceWorker.controller) {
    return false;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.waiting ? takeOver(registration.waiting) : false;
}

/** Registers the service worker; an open page asks for a new version now and then. */
export function registerServiceWorker(): void {
  if (!supported()) {
    return;
  }
  void navigator.serviceWorker
    .register(SERVICE_WORKER_PATH, { scope: "/" })
    .then((registration) => {
      // Spread out, so a class's devices don't all ask at the same moment.
      const every = UPDATE_EVERY_MS * (1 + Math.random());
      setInterval(() => void registration.update().catch(() => {}), every);
    })
    .catch(() => {
      // Without a service worker the app still runs from the network.
    });
}

/**
 * Brings a new version in right away: for an app older than what it was
 * sent (a newer content format). Reloads into it and resolves true, or
 * resolves false when the server has nothing newer. Without a service
 * worker a reload loads the server's version.
 */
export async function updateApp(): Promise<boolean> {
  const registration = supported()
    ? await navigator.serviceWorker.getRegistration()
    : undefined;
  if (!registration?.active) {
    window.location.reload();
    return true;
  }
  await registration.update().catch(() => {});
  const worker = registration.installing ?? registration.waiting;
  if (!worker || !(await installed(worker))) {
    return false;
  }
  return takeOver(worker);
}

/** Forgets the data kept for offline use: it belonged to another visitor. */
export function forgetOfflineData(): void {
  if (typeof caches !== "undefined") {
    void caches.delete(DATA_CACHE).catch(() => {});
  }
}
