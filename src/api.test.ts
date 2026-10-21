import { describe, expect, test } from "bun:test";
import { compileApi, handleApi, matchApi } from "./api.js";
import { routeDeclarationSchema } from "./route-declaration.js";

const table = compileApi([
  {
    path: "/api/sheets/:sheetId",
    module: {
      GET: ({ params }) => Response.json({ sheet: params.sheetId }),
      POST: () => new Response("saved"),
    },
  },
  { path: "/api/sheets/new", module: { GET: () => new Response("never") } },
  {
    path: "/api/fail",
    module: {
      GET: () => {
        throw new Response(null, { status: 404 });
      },
    },
  },
]);

const call = (path: string, method = "GET") =>
  handleApi(table, new Request(`http://local${path}`, { method }));

async function answer(path: string, method = "GET"): Promise<Response> {
  const response = await call(path, method);
  if (!response) {
    throw new Error(`no endpoint for ${path}`);
  }
  return response;
}

describe("API endpoints", () => {
  test("match by segments and decode parameters", async () => {
    expect(matchApi(table, "/api/sheets/a%20b")?.params).toEqual({
      sheetId: "a b",
    });
    expect(matchApi(table, "/api/sheets")).toBeUndefined();
    expect(matchApi(table, "/api/sheets/a/b")).toBeUndefined();
    expect(await (await answer("/api/sheets/x")).json()).toEqual({
      sheet: "x",
    });
  });

  test("the first declared endpoint wins", async () => {
    expect(await (await answer("/api/sheets/new")).json()).toEqual({
      sheet: "new",
    });
  });

  test("HEAD uses GET; a missing method is 405 with Allow", async () => {
    expect((await answer("/api/sheets/x", "HEAD")).status).toBe(200);
    const refused = await answer("/api/sheets/x", "DELETE");
    expect(refused.status).toBe(405);
    expect(refused.headers.get("Allow")).toBe("GET, POST");
  });

  test("a thrown Response is the answer; no match is undefined", async () => {
    expect((await answer("/api/fail")).status).toBe(404);
    expect(await call("/courses")).toBeUndefined();
  });

  test("an endpoint declaration needs a path and has no children", () => {
    const ok = routeDeclarationSchema.safeParse({
      path: "api/x",
      api: true,
      file: "./x",
    });
    expect(ok.success).toBe(true);
    for (const bad of [
      { index: true, api: true, file: "./x" },
      { layout: true, api: true, file: "./x", children: [] },
      { path: "api/x", api: true, file: "./x", children: [] },
    ]) {
      expect(routeDeclarationSchema.safeParse(bad).success).toBe(false);
    }
  });
});
