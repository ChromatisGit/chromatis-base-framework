import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  serviceWorkerConfig,
  serviceWorkerSource,
  type ServiceWorkerConfig,
} from "./serviceWorker.js";

const ORIGIN = "https://app.test";

function clientBuild(files: Record<string, string>): string {
  const client = mkdtempSync(path.join(tmpdir(), "chromatis-sw-"));
  mkdirSync(path.join(client, "assets"));
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(path.join(client, file), content);
  }
  return client;
}

/** Cache Storage in memory, keyed by URL; enough for the worker. */
function cacheStorage() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: Request | string) =>
    new URL(typeof request === "string" ? request : request.url, ORIGIN).href;
  const open = (name: string) => {
    let store = stores.get(name);
    if (!store) {
      store = new Map();
      stores.set(name, store);
    }
    const entries = store;
    return {
      match: (request: Request | string) =>
        Promise.resolve(entries.get(key(request))?.clone()),
      put: (request: Request | string, response: Response) => {
        entries.set(key(request), response.clone());
        return Promise.resolve();
      },
    };
  };
  return {
    stores,
    open: (name: string) => Promise.resolve(open(name)),
    match: async (request: Request | string) => {
      for (const name of stores.keys()) {
        const found = await open(name).match(request);
        if (found) {
          return found;
        }
      }
      return undefined;
    },
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
  };
}

type Handler = (event: Record<string, unknown>) => void;

/** Runs the worker's source against fakes; `network` answers its fetches. */
function startWorker(
  config: ServiceWorkerConfig,
  network: (url: string) => Response | Promise<Response>,
  caches = cacheStorage(),
  active = false,
) {
  const handlers = new Map<string, Handler>();
  const fetched: string[] = [];
  const self = {
    location: new URL(ORIGIN),
    registration: { active: active ? {} : null },
    clients: { claim: () => Promise.resolve() },
    skipWaiting: () => Promise.resolve(),
    addEventListener: (type: string, handler: Handler) =>
      handlers.set(type, handler),
  };
  const fetch = async (input: Request | string) => {
    const url = new URL(typeof input === "string" ? input : input.url, ORIGIN)
      .href;
    fetched.push(url);
    return network(url);
  };
  new Function("self", "caches", "fetch", serviceWorkerSource(config))(
    self,
    caches,
    fetch,
  );
  const lifecycle = async (type: string) => {
    let done: Promise<unknown> = Promise.resolve();
    handlers.get(type)?.({
      waitUntil: (promise: Promise<unknown>) => (done = promise),
    });
    await done;
  };
  const request = async (url: string, mode = "cors") => {
    let answer: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    handlers.get("fetch")?.({
      request: new Request(new URL(url, ORIGIN), {
        mode: mode as RequestMode,
      }),
      respondWith: (response: Promise<Response>) => (answer = response),
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    const response = await answer;
    await Promise.all(pending);
    return response;
  };
  return { caches, fetched, lifecycle, request };
}

const config = (overrides: Partial<ServiceWorkerConfig> = {}) => ({
  ...serviceWorkerConfig(
    clientBuild({
      "index.html": "<html>app</html>",
      "assets/index-a1.js": "a",
      "assets/index-a1.css": "c",
      "assets/font-f1.woff2": "f",
      "assets/font-f1.woff": "old",
    }),
    ["/files/"],
  ),
  ...overrides,
});

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

describe("serviceWorkerConfig", () => {
  test("caches scripts, styles and WOFF2 fonts, and carries the document", () => {
    const value = config();
    expect(value.precache).toEqual([
      "/assets/font-f1.woff2",
      "/assets/index-a1.css",
      "/assets/index-a1.js",
    ]);
    expect(value.shell).toBe("<html>app</html>");
    expect(value.version).toHaveLength(16);
  });

  test("its version changes with the build's files", () => {
    const one = serviceWorkerConfig(
      clientBuild({ "index.html": "x", "assets/a-1.js": "" }),
      [],
    );
    const same = serviceWorkerConfig(
      clientBuild({ "index.html": "x", "assets/a-1.js": "" }),
      [],
    );
    const other = serviceWorkerConfig(
      clientBuild({ "index.html": "x", "assets/a-2.js": "" }),
      [],
    );
    expect(same.version).toBe(one.version);
    expect(other.version).not.toBe(one.version);
  });
});

describe("the service worker", () => {
  test("installs the build's files, reusing what an earlier version has", async () => {
    const caches = cacheStorage();
    await (
      await caches.open("chromatis-assets-old")
    ).put("/assets/font-f1.woff2", new Response("f"));
    const worker = startWorker(config(), () => new Response("x"), caches);
    await worker.lifecycle("install");
    expect(worker.fetched).toEqual([
      `${ORIGIN}/assets/index-a1.css`,
      `${ORIGIN}/assets/index-a1.js`,
    ]);
  });

  test("keeps this version's files and the previous version's", async () => {
    const caches = cacheStorage();
    for (const version of ["one", "two"]) {
      const worker = startWorker(
        config({ version }),
        () => new Response("x"),
        caches,
      );
      await worker.lifecycle("install");
      await worker.lifecycle("activate");
    }
    await (
      await caches.open("chromatis-assets-stray")
    ).put("/assets/x.js", new Response("x"));
    const third = startWorker(
      config({ version: "three" }),
      () => new Response("x"),
      caches,
    );
    await third.lifecycle("install");
    await third.lifecycle("activate");
    expect(
      [...caches.stores.keys()].filter((name) => name.includes("assets")),
    ).toEqual(["chromatis-assets-two", "chromatis-assets-three"]);
  });

  test("answers an address of the app from the device once it served the app", async () => {
    let calls = 0;
    const worker = startWorker(config(), () => {
      calls += 1;
      return new Response("network", {
        headers: { "x-chromatis-document": "app" },
      });
    });
    const first = await worker.request("/unterricht", "navigate");
    expect(await first?.text()).toBe("network");
    const second = await worker.request("/unterricht", "navigate");
    expect(await second?.text()).toBe("<html>app</html>");
    expect(calls).toBe(1);
  });

  test("takes a static page from the network and keeps it for offline use", async () => {
    let online = true;
    const worker = startWorker(config(), () =>
      online ? new Response("landing") : offline(),
    );
    await worker.request("/", "navigate");
    online = false;
    expect(await (await worker.request("/", "navigate"))?.text()).toBe(
      "landing",
    );
    expect(await (await worker.request("/new", "navigate"))?.text()).toBe(
      "<html>app</html>",
    );
  });

  test("keeps each route's data and answers offline from it", async () => {
    let online = true;
    const worker = startWorker(config(), () =>
      online
        ? Response.json({
            results: { root: { data: "r" }, sheet: { data: "s" } },
          })
        : offline(),
    );
    const page = "/_chromatis/data/k/s/c/sheets/a";
    await worker.request(`${page}?_routes=root,sheet`);
    online = false;
    const answer = await worker.request(`${page}?_routes=sheet`);
    expect(await answer?.json()).toEqual({
      results: { sheet: { data: "s" } },
    });
    expect(answer?.headers.get("x-chromatis-offline")).toBe("1");
    expect(worker.request(`${page}?_routes=root,shell`)).rejects.toThrow();
  });

  test("keeps immutable files once fetched", async () => {
    const worker = startWorker(config(), () => new Response("material"));
    await worker.request("/files/m/abc.json");
    await worker.request("/files/m/abc.json");
    expect(worker.fetched).toEqual([`${ORIGIN}/files/m/abc.json`]);
  });
});
