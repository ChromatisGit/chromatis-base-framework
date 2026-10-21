/**
 * The server side of page data: runs the `loader`s and `action`s of pages'
 * server files and answers the browser router in JSON (see data-protocol.ts).
 * Every loader of one request runs in the same request scope, so what they
 * share (the session, for example) is worked out once.
 */
import { compileApi, matchApi, type ApiTable } from "./api.js";
import {
  DATA_PREFIX,
  ROUTE_PARAM,
  ROUTES_PARAM,
  type DataResponse,
  type DataResult,
} from "./data-protocol.js";

/** What a server `loader` or `action` receives. */
export type DataArgs = Readonly<{
  /** The page's request: its URL and the browser's headers and cookies. */
  request: Request;
  params: Readonly<Record<string, string>>;
}>;

/** A page's server file. */
export type ServerRouteModule = Readonly<{
  loader?: (args: DataArgs) => unknown;
  action?: (args: DataArgs) => unknown;
}>;

/** One route as the build lists it. */
export type DataEntry = Readonly<{
  id: string;
  /** The full URL path of a page; undefined for layouts. */
  path: string | undefined;
  /** The route's server file, when it has one. */
  module: ServerRouteModule | undefined;
}>;

export type DataTable = Readonly<{
  modules: ReadonlyMap<string, ServerRouteModule>;
  pages: ApiTable;
}>;

export function compileData(entries: readonly DataEntry[]): DataTable {
  return {
    modules: new Map(
      entries.flatMap((entry) =>
        entry.module ? [[entry.id, entry.module] as const] : [],
      ),
    ),
    // Only the path matters for the parameters; the module is unused.
    pages: compileApi(
      entries.flatMap((entry) =>
        entry.path === undefined ? [] : [{ path: entry.path, module: {} }],
      ),
    ),
  };
}

/** React Router's `data()` result, recognised without depending on its class. */
function withInit(
  value: unknown,
): { data: unknown; init: ResponseInit | undefined } | undefined {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "DataWithResponseInit"
  ) {
    const { data, init } = value as { data: unknown; init?: ResponseInit };
    return { data, init: init ?? undefined };
  }
  return undefined;
}

type Redirect = Extract<DataResponse, { redirect: string }>;

type Outcome =
  | { redirect: Redirect; cookies: string[] }
  | { result: DataResult; cookies: string[] };

const isRedirect = (response: Response) =>
  response.status >= 300 &&
  response.status < 400 &&
  response.headers.has("Location");

/** React Router's redirect headers, and a new cookie, carried to the browser. */
function redirectOf(response: Response, cookies: readonly string[]): Redirect {
  return {
    redirect: response.headers.get("Location") ?? "/",
    ...(cookies.length > 0 || response.headers.has("X-Remix-Revalidate")
      ? { revalidate: true }
      : {}),
    ...(response.headers.has("X-Remix-Reload-Document")
      ? { reload: true }
      : {}),
  };
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  return response.headers.get("Content-Type")?.includes("json")
    ? (JSON.parse(text) as unknown)
    : text;
}

/** A loader's or action's return value or thrown value, as the browser gets it. */
async function outcome(value: unknown, thrown: boolean): Promise<Outcome> {
  if (value instanceof Response) {
    const cookies = value.headers.getSetCookie();
    if (isRedirect(value)) {
      return { redirect: redirectOf(value, cookies), cookies };
    }
    const body = await responseBody(value);
    // As in React Router, only a thrown value is an error; a returned one is
    // data whatever its status (a form's validation errors, for example).
    if (thrown) {
      return {
        result: {
          error: {
            status: value.status,
            ...(value.statusText ? { statusText: value.statusText } : {}),
            ...(body === undefined ? {} : { data: body }),
          },
        },
        cookies,
      };
    }
    return { result: { data: body ?? null }, cookies };
  }
  const init = withInit(value);
  if (init) {
    const headers = new Headers(init.init?.headers);
    const status = init.init?.status ?? 200;
    if (thrown) {
      return {
        result: { error: { status, data: init.data } },
        cookies: headers.getSetCookie(),
      };
    }
    return {
      result: { data: init.data ?? null, status },
      cookies: headers.getSetCookie(),
    };
  }
  if (thrown) {
    throw value;
  }
  return { result: { data: value ?? null }, cookies: [] };
}

async function run(
  handler: (args: DataArgs) => unknown,
  args: DataArgs,
): Promise<Outcome> {
  let value: unknown;
  try {
    value = await handler(args);
  } catch (error) {
    return outcome(error, true);
  }
  return outcome(value, false);
}

function reply(body: DataResponse, cookies: readonly string[]): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(JSON.stringify(body), { headers });
}

const notFound = { error: { status: 404 } } as const;

/**
 * Answers a request to the data endpoint: the loaders of `?_routes=` (GET) or
 * the action of `?_route=` (POST and the other methods). Undefined for every
 * other path.
 */
export async function handleData(
  table: DataTable,
  request: Request,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (
    url.pathname !== DATA_PREFIX &&
    !url.pathname.startsWith(`${DATA_PREFIX}/`)
  ) {
    return undefined;
  }
  const page = new URL(url);
  page.pathname = url.pathname.slice(DATA_PREFIX.length) || "/";
  const ids = (url.searchParams.get(ROUTES_PARAM) ?? "")
    .split(",")
    .filter(Boolean);
  const actionId = url.searchParams.get(ROUTE_PARAM);
  page.searchParams.delete(ROUTES_PARAM);
  page.searchParams.delete(ROUTE_PARAM);
  const params = matchApi(table.pages, page.pathname)?.params;
  const read = request.method === "GET" || request.method === "HEAD";
  const pageRequest = new Request(page, {
    method: request.method,
    headers: request.headers,
    ...(read ? {} : { body: request.body, duplex: "half" }),
  } as RequestInit);

  if (!read) {
    const action = actionId ? table.modules.get(actionId)?.action : undefined;
    if (!params || !action) {
      return reply({ results: { [actionId ?? ""]: notFound } }, []);
    }
    const done = await run(action, { request: pageRequest, params });
    return "redirect" in done
      ? reply(done.redirect, done.cookies)
      : reply({ results: { [actionId ?? ""]: done.result } }, done.cookies);
  }

  if (!params) {
    return reply(
      { results: Object.fromEntries(ids.map((id) => [id, notFound])) },
      [],
    );
  }
  // Loaders run together, as the browser router runs them; the request scope
  // lets them share what they work out.
  const outcomes = await Promise.all(
    ids.map(async (id): Promise<[string, Outcome]> => {
      const loader = table.modules.get(id)?.loader;
      return [
        id,
        loader
          ? await run(loader, { request: pageRequest, params })
          : { result: { data: null }, cookies: [] },
      ];
    }),
  );
  const cookies = outcomes.flatMap(([, done]) => done.cookies);
  const redirected = outcomes.find(([, done]) => "redirect" in done)?.[1];
  if (redirected && "redirect" in redirected) {
    return reply(
      cookies.length > 0
        ? { ...redirected.redirect, revalidate: true }
        : redirected.redirect,
      cookies,
    );
  }
  return reply(
    {
      results: Object.fromEntries(
        outcomes.map(([id, done]) => [
          id,
          "result" in done ? done.result : notFound,
        ]),
      ),
    },
    cookies,
  );
}
