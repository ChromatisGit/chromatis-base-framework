/**
 * The app's service worker (`/sw.js`): the build prepends `const CONFIG`
 * (infra/scripts/serviceWorker.ts) and serves this file as it is.
 *
 * - The build's files are cached when a version installs, so the app starts
 *   from the device. A new version waits; the page activates it at its next
 *   start (client.tsx), never while a page is open.
 * - A page address that answered with the app's document is answered from
 *   this version's copy of it; any other page (a static site in front of the
 *   app) comes from the network and is kept for offline use.
 * - Data requests go to the network; each route's result is kept, so a page
 *   whose data was loaded once opens without a network.
 * - Files under `CONFIG.immutable` never change: kept once fetched.
 */
/* global CONFIG, self, caches, fetch, Response, URL */

const ASSETS_PREFIX = "chromatis-assets-";
const ASSETS = `${ASSETS_PREFIX}${CONFIG.version}`;
const IMMUTABLE = "chromatis-immutable";
const PAGES = "chromatis-pages";
const META = "chromatis-meta";
const ROUTE_KEY = "_chromatis_route";

/** The worker's global scope (`ServiceWorkerGlobalScope`). */
const worker = self;

const json = (value, headers = {}) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json", ...headers },
  });

/** This version's document: the app starts from it on any of its pages. */
const shell = () =>
  new Response(CONFIG.shell, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      [CONFIG.documentHeader]: "app",
    },
  });

async function precache() {
  const cache = await caches.open(ASSETS);
  await Promise.all(
    CONFIG.precache.map(async (url) => {
      if (await cache.match(url)) {
        return;
      }
      // A file an earlier version already has (same hash) is not fetched again.
      const known = await caches.match(url, { ignoreVary: true });
      const response = known ?? (await fetch(url));
      if (!response.ok) {
        throw new Error(`${url}: ${response.status}`);
      }
      await cache.put(url, response);
    }),
  );
}

worker.addEventListener("install", (event) => {
  event.waitUntil(
    precache().then(() =>
      // The first version has nothing to wait for.
      worker.registration.active ? undefined : worker.skipWaiting(),
    ),
  );
});

worker.addEventListener("message", (event) => {
  if (event.data?.type === "chromatis:activate") {
    void worker.skipWaiting();
  }
});

/**
 * Keeps this version's files and the previous version's: a page that still
 * runs it may load one of its chunks later.
 */
async function activate() {
  const meta = await caches.open(META);
  const previous = await (await meta.match("/active"))?.text();
  if (previous !== CONFIG.version) {
    await meta.put("/active", new Response(CONFIG.version));
    if (previous) {
      await meta.put("/previous", new Response(previous));
    }
  }
  const before = await (await meta.match("/previous"))?.text();
  const keep = new Set([ASSETS, `${ASSETS_PREFIX}${before}`]);
  for (const name of await caches.keys()) {
    if (name.startsWith(ASSETS_PREFIX) && !keep.has(name)) {
      await caches.delete(name);
    }
  }
  await worker.clients.claim();
}

worker.addEventListener("activate", (event) => {
  event.waitUntil(activate());
});

async function cacheFirst(request, name) {
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    await (await caches.open(name)).put(request, response.clone());
  }
  return response;
}

const pageKey = (url) => `${url.origin}${url.pathname}${url.search}`;

async function navigate(request, url) {
  const pages = await caches.open(PAGES);
  const known = await pages.match(pageKey(url));
  if (known?.headers.get(CONFIG.documentHeader)) {
    return shell();
  }
  try {
    const response = await fetch(request);
    if (response.ok) {
      // For the app's document only the fact is kept; the copy is this version's.
      await pages.put(
        pageKey(url),
        response.headers.get(CONFIG.documentHeader)
          ? new Response(null, { headers: { [CONFIG.documentHeader]: "app" } })
          : response.clone(),
      );
    }
    return response;
  } catch {
    return known ?? shell();
  }
}

/** Where one route's result for a data request is kept. */
function dataKey(url, id) {
  const key = new URL(url);
  key.searchParams.delete(CONFIG.routesParam);
  key.searchParams.set(ROUTE_KEY, id);
  return key.href;
}

const routeIds = (url) =>
  (url.searchParams.get(CONFIG.routesParam) ?? "").split(",").filter(Boolean);

async function remember(response, url) {
  const body = await response.json().catch(() => null);
  const results = body?.results;
  if (!results) {
    return;
  }
  const cache = await caches.open(CONFIG.dataCache);
  await Promise.all(
    routeIds(url).flatMap((id) =>
      id in results ? [cache.put(dataKey(url, id), json(results[id]))] : [],
    ),
  );
}

/** A data response put together from kept results, if every route has one. */
async function recall(url) {
  const ids = routeIds(url);
  if (!ids.length) {
    return undefined;
  }
  const cache = await caches.open(CONFIG.dataCache);
  const results = {};
  for (const id of ids) {
    const kept = await cache.match(dataKey(url, id));
    if (!kept) {
      return undefined;
    }
    results[id] = await kept.json();
  }
  return json({ results }, { [CONFIG.offlineHeader]: "1" });
}

async function data(event, url) {
  try {
    const response = await fetch(event.request);
    if (response.ok) {
      event.waitUntil(remember(response.clone(), url));
    }
    return response;
  } catch (error) {
    const kept = await recall(url);
    if (kept) {
      return kept;
    }
    throw error;
  }
}

const under = (pathname, prefix) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

worker.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== worker.location.origin) {
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(navigate(request, url));
  } else if (
    url.pathname.startsWith("/assets/") ||
    CONFIG.precache.includes(url.pathname)
  ) {
    event.respondWith(cacheFirst(request, ASSETS));
  } else if (
    CONFIG.immutable.some((prefix) => url.pathname.startsWith(prefix))
  ) {
    event.respondWith(cacheFirst(request, IMMUTABLE));
  } else if (under(url.pathname, CONFIG.dataPrefix)) {
    event.respondWith(data(event, url));
  }
});
