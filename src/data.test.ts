import { describe, expect, test } from "bun:test";
import { data, redirect, redirectDocument } from "react-router";
import { compileData, handleData, type DataArgs } from "./data.js";
import type { DataResponse } from "./data-protocol.js";

const calls: string[] = [];

const table = compileData([
  {
    id: "root",
    path: undefined,
    module: {
      loader: ({ request }: DataArgs) => {
        calls.push(`root ${new URL(request.url).pathname}`);
        return { viewer: request.headers.get("Cookie") ?? "guest" };
      },
    },
  },
  { id: "layout", path: undefined, module: undefined },
  {
    id: "sheet",
    path: "/sheets/:sheetId",
    module: {
      loader: ({ params, request }: DataArgs) => {
        calls.push(`sheet ${params.sheetId} ${new URL(request.url).search}`);
        if (params.sheetId === "missing") {
          throw new Response("no such sheet", { status: 404 });
        }
        if (params.sheetId === "old") {
          throw redirect("/sheets/new", {
            headers: { "Set-Cookie": "moved=1; Path=/" },
          });
        }
        return { sheet: params.sheetId };
      },
    },
  },
  {
    id: "login",
    path: "/login",
    module: {
      action: async ({ request }: DataArgs) => {
        const form = await request.formData();
        if (form.get("password") !== "right") {
          return data({ error: "invalid" }, { status: 401 });
        }
        return redirect("/courses", {
          headers: [
            ["Set-Cookie", "teacher=1; Path=/"],
            ["Set-Cookie", "unit=; Max-Age=0"],
          ],
        });
      },
    },
  },
  {
    id: "echo",
    path: "/echo",
    module: {
      action: async ({ request }: DataArgs) => ({
        method: request.method,
        type: request.headers.get("Content-Type"),
        body: (await request.json()) as unknown,
      }),
      loader: () => {
        throw new Error("boom");
      },
    },
  },
]);

async function send(
  path: string,
  init?: RequestInit,
): Promise<{ response: Response; body: DataResponse }> {
  const response = await handleData(
    table,
    new Request(`http://local/_chromatis/data${path}`, init),
  );
  if (!response) {
    throw new Error(`not a data request: ${path}`);
  }
  return { response, body: (await response.json()) as DataResponse };
}

const post = (path: string, form: Record<string, string>) =>
  send(path, { method: "POST", body: new URLSearchParams(form) });

describe("page data", () => {
  test("one request runs every requested loader with the page's URL", async () => {
    calls.length = 0;
    const { response, body } = await send(
      "/sheets/a%20b?tab=2&_routes=root,layout,sheet",
      { headers: { Cookie: "teacher" } },
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      results: {
        root: { data: { viewer: "teacher" } },
        layout: { data: null },
        sheet: { data: { sheet: "a b" } },
      },
    });
    expect(calls.sort()).toEqual(["root /sheets/a%20b", "sheet a b ?tab=2"]);
  });

  test("the site root's data lives at the bare prefix", async () => {
    const response = await handleData(
      compileData([{ id: "home", path: "/", module: { loader: () => 1 } }]),
      new Request("http://local/_chromatis/data?_routes=home"),
    );
    expect(await response?.json()).toEqual({ results: { home: { data: 1 } } });
  });

  test("other paths are not data requests", async () => {
    expect(
      await handleData(table, new Request("http://local/_chromatis/database")),
    ).toBeUndefined();
    expect(
      await handleData(table, new Request("http://local/sheets/a")),
    ).toBeUndefined();
  });

  test("a redirect wins and keeps its cookies", async () => {
    const { response, body } = await send("/sheets/old?_routes=root,sheet");
    expect(body).toEqual({ redirect: "/sheets/new", revalidate: true });
    expect(response.headers.getSetCookie()).toEqual(["moved=1; Path=/"]);
  });

  test("a thrown Response is the route's error", async () => {
    const { body } = await send("/sheets/missing?_routes=root,sheet");
    expect(body).toEqual({
      results: {
        root: { data: { viewer: "guest" } },
        sheet: { error: { status: 404, data: "no such sheet" } },
      },
    });
  });

  test("an unknown page answers 404 for every route", async () => {
    const { body } = await send("/nowhere?_routes=root,sheet");
    expect(body).toEqual({
      results: {
        root: { error: { status: 404 } },
        sheet: { error: { status: 404 } },
      },
    });
  });

  test("a thrown Error is not turned into data", async () => {
    await expect(send("/echo?_routes=echo")).rejects.toThrow("boom");
  });
});

describe("page actions", () => {
  test("a returned 4xx stays data, with its status", async () => {
    const { response, body } = await post("/login?_route=login", {
      password: "wrong",
    });
    expect(response.status).toBe(200);
    expect(body).toEqual({
      results: { login: { data: { error: "invalid" }, status: 401 } },
    });
  });

  test("a redirect carries every Set-Cookie", async () => {
    const { response, body } = await post("/login?_route=login", {
      password: "right",
    });
    expect(body).toEqual({ redirect: "/courses", revalidate: true });
    expect(response.headers.getSetCookie()).toEqual([
      "teacher=1; Path=/",
      "unit=; Max-Age=0",
    ]);
  });

  test("the method, content type and body reach the action", async () => {
    const { body } = await send("/echo?_route=echo", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: 42 }),
    });
    expect(body).toEqual({
      results: {
        echo: {
          data: {
            method: "PUT",
            type: "application/json",
            body: { answer: 42 },
          },
        },
      },
    });
  });

  test("a plain redirect needs no revalidation; redirectDocument reloads", async () => {
    const table = compileData([
      { id: "a", path: "/a", module: { action: () => redirect("/b") } },
      { id: "b", path: "/b", module: { action: () => redirectDocument("/c") } },
    ]);
    const answer = async (path: string) =>
      (
        await handleData(
          table,
          new Request(`http://local/_chromatis/data${path}`, {
            method: "POST",
          }),
        )
      )?.json();
    expect(await answer("/a?_route=a")).toEqual({ redirect: "/b" });
    expect(await answer("/b?_route=b")).toEqual({
      redirect: "/c",
      reload: true,
    });
  });

  test("a route without an action is 404", async () => {
    const { body } = await post("/sheets/a?_route=sheet", {});
    expect(body).toEqual({ results: { sheet: { error: { status: 404 } } } });
  });
});
