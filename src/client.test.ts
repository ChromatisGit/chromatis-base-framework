import { afterEach, describe, expect, test } from "bun:test";
import type { DataStrategyFunctionArgs } from "react-router";
import { createDataStrategy, dataUrl, redirectTo, unpack } from "./client.js";
import type { DataResponse } from "./data-protocol.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers every fetch with `body` and records the URLs asked for. */
function serve(body: DataResponse): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json(body);
  }) as typeof fetch;
  return urls;
}

/** The parts of a navigation's matches the strategy uses. */
function navigation(
  url: string,
  routes: readonly { id: string; run?: boolean; loader?: () => unknown }[],
) {
  return {
    request: new Request(url),
    matches: routes.map((route) => ({
      route: { id: route.id },
      shouldCallHandler: () => route.run ?? true,
      resolve: async (call: (handler: () => unknown) => Promise<unknown>) => {
        try {
          return {
            type: "data",
            result: await call(route.loader ?? (() => null)),
          };
        } catch (error) {
          return { type: "error", result: error };
        }
      },
    })),
  } as unknown as DataStrategyFunctionArgs;
}

describe("data URLs", () => {
  test("keep the page's path and query", () => {
    expect(dataUrl("http://x/sheets/a?tab=2", "_routes", "root,sheet")).toBe(
      "http://x/_chromatis/data/sheets/a?tab=2&_routes=root%2Csheet",
    );
    expect(dataUrl("http://x/", "_route", "root")).toBe(
      "http://x/_chromatis/data?_route=root",
    );
  });
});

describe("unpacking a route's result", () => {
  test("data is returned, an error is thrown as a Response", async () => {
    expect(unpack({ data: { a: 1 }, status: 401 })).toEqual({ a: 1 });
    let thrown: unknown;
    try {
      unpack({ error: { status: 403, statusText: "No", data: { why: "x" } } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(403);
    expect(response.statusText).toBe("No");
    expect(await response.json()).toEqual({ why: "x" });
  });

  test("a missing result is 404", () => {
    expect(() => unpack(undefined)).toThrow();
  });
});

describe("redirects", () => {
  test("carry React Router's revalidate and reload headers", () => {
    const plain = redirectTo({ redirect: "/a" });
    expect(plain.status).toBe(302);
    expect(plain.headers.get("Location")).toBe("/a");
    expect(plain.headers.has("X-Remix-Revalidate")).toBe(false);
    const cookie = redirectTo({ redirect: "/a", revalidate: true });
    expect(cookie.headers.has("X-Remix-Revalidate")).toBe(true);
    const reload = redirectTo({ redirect: "/a", reload: true });
    expect(reload.headers.has("X-Remix-Reload-Document")).toBe(true);
  });
});

describe("the data strategy", () => {
  test("loads every server route of a navigation in one request", async () => {
    const urls = serve({
      results: { root: { data: "r" }, sheet: { data: "s" } },
    });
    const strategy = createDataStrategy(new Set(["root", "sheet"]));
    const results = await strategy(
      navigation("http://x/sheets/a", [
        { id: "root" },
        { id: "layout", loader: () => "client" },
        { id: "sheet" },
        { id: "cached", run: false },
      ]),
    );
    expect(urls).toEqual([
      "http://x/_chromatis/data/sheets/a?_routes=root%2Csheet",
    ]);
    expect(results).toEqual({
      root: { type: "data", result: "r" },
      layout: { type: "data", result: "client" },
      sheet: { type: "data", result: "s" },
    });
  });

  test("makes no request without server routes", async () => {
    const urls = serve({ results: {} });
    await createDataStrategy(new Set(["root"]))(
      navigation("http://x/", [{ id: "root", run: false }, { id: "page" }]),
    );
    expect(urls).toEqual([]);
  });

  test("a redirect reaches every server route", async () => {
    serve({ redirect: "/login" });
    const results = await createDataStrategy(new Set(["root", "sheet"]))(
      navigation("http://x/sheets/a", [{ id: "root" }, { id: "sheet" }]),
    );
    for (const id of ["root", "sheet"]) {
      const { type, result } = results[id] as { type: string; result: unknown };
      expect(type).toBe("error");
      expect((result as Response).headers.get("Location")).toBe("/login");
    }
  });

  test("a route's error stays with that route", async () => {
    serve({
      results: { root: { data: 1 }, sheet: { error: { status: 404 } } },
    });
    const results = await createDataStrategy(new Set(["root", "sheet"]))(
      navigation("http://x/sheets/a", [{ id: "root" }, { id: "sheet" }]),
    );
    expect(results.root).toEqual({ type: "data", result: 1 });
    expect((results.sheet?.result as Response).status).toBe(404);
  });
});
