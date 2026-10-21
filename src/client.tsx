/**
 * The browser side of a Chromatis app: the generated entry calls `startApp`
 * with the route tree. Pages render in the browser; the loaders and actions of
 * their server files run on the server, and one request per navigation
 * fetches every server loader it needs (see data-protocol.ts).
 */
import { StrictMode, useLayoutEffect, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  redirect,
  RouterProvider,
  ScrollRestoration,
  useLocation,
  useMatches,
  useRouteError,
  type DataStrategyFunction,
  type MetaDescriptor,
  type RouteObject,
} from "react-router";
import {
  DATA_PREFIX,
  ROUTE_PARAM,
  ROUTES_PARAM,
  type DataResponse,
  type DataResult,
} from "./data-protocol.js";

/** What a page file exports. */
export type PageModule = Readonly<{
  default?: ComponentType;
  /** Receives the error as a prop, as in React Router's framework mode. */
  ErrorBoundary?: ComponentType<{ error: unknown }>;
  HydrateFallback?: ComponentType;
  meta?: MetaFunctionLike;
  handle?: Record<string, unknown>;
}>;

/** What a page's `meta` receives: its loader's data once loaded. */
export type MetaArgs<Loader extends (...args: never[]) => unknown> = Readonly<{
  data: Awaited<ReturnType<Loader>> | undefined;
  params: Readonly<Record<string, string | undefined>>;
}>;

type MetaFunctionLike = (args: {
  data: unknown;
  params: Readonly<Record<string, string | undefined>>;
}) => readonly MetaDescriptor[] | undefined;

function errorBoundary(Boundary: ComponentType<{ error: unknown }>) {
  return function RouteErrorBoundary() {
    return <Boundary error={useRouteError()} />;
  };
}

/** A route as the generated entry lists it. */
export type ClientRoute = Readonly<{
  id: string;
  path?: string;
  index?: true;
  /** The route has a server file: its loader and action run on the server. */
  server?: true;
  page: () => Promise<PageModule>;
  children?: readonly ClientRoute[];
}>;

export type AppDefinition = Readonly<{
  root: PageModule;
  rootServer?: boolean;
  routes: readonly ClientRoute[];
}>;

/** The page URL's counterpart on the data endpoint. */
export function dataUrl(page: string, param: string, value: string): string {
  const url = new URL(page);
  const target = new URL(
    `${DATA_PREFIX}${url.pathname === "/" ? "" : url.pathname}`,
    url.origin,
  );
  target.search = url.search;
  target.searchParams.set(param, value);
  return target.href;
}

async function readData(response: Response): Promise<DataResponse> {
  if (!response.ok) {
    throw new Response(null, {
      status: response.status,
      statusText: response.statusText,
    });
  }
  return (await response.json()) as DataResponse;
}

/** The server's redirect as the router's, with the headers it understands. */
export function redirectTo(
  body: Extract<DataResponse, { redirect: string }>,
): Response {
  return redirect(body.redirect, {
    headers: {
      ...(body.revalidate ? { "X-Remix-Revalidate": "yes" } : {}),
      ...(body.reload ? { "X-Remix-Reload-Document": "true" } : {}),
    },
  });
}

/** A route's result as the router expects it from a loader or action. */
export function unpack(result: DataResult | undefined): unknown {
  if (!result) {
    throw new Response(null, { status: 404 });
  }
  if ("error" in result) {
    const { status, statusText, data } = result.error;
    throw new Response(data === undefined ? null : JSON.stringify(data), {
      status,
      ...(statusText ? { statusText } : {}),
      headers: { "Content-Type": "application/json" },
    });
  }
  return result.data;
}

async function loadServer(
  request: Request,
  ids: readonly string[],
): Promise<DataResponse> {
  return readData(
    await fetch(dataUrl(request.url, ROUTES_PARAM, ids.join(",")), {
      signal: request.signal,
      headers: { Accept: "application/json" },
    }),
  );
}

/** A route's action: the request goes to its server file. */
const serverAction =
  (id: string) =>
  async ({ request }: { request: Request }) => {
    const contentType = request.headers.get("Content-Type");
    const body = await readData(
      await fetch(dataUrl(request.url, ROUTE_PARAM, id), {
        method: request.method,
        signal: request.signal,
        headers: contentType ? { "Content-Type": contentType } : {},
        body: await request.arrayBuffer(),
      }),
    );
    if ("redirect" in body) {
      return redirectTo(body);
    }
    return unpack(body.results[id]);
  };

/** Placeholder: `dataStrategy` answers server loaders from the batch. */
const serverLoader = () => null;

export function createDataStrategy(
  servers: ReadonlySet<string>,
): DataStrategyFunction {
  return async ({ request, matches }) => {
    const pending = matches.filter((match) => match.shouldCallHandler());
    const ids =
      request.method === "GET"
        ? pending
            .filter((match) => servers.has(match.route.id))
            .map((match) => match.route.id)
        : [];
    const batch = ids.length ? loadServer(request, ids) : undefined;
    // Kept from rejecting unobserved; every server match awaits it below.
    batch?.catch(() => undefined);
    const results = await Promise.all(
      pending.map(async (match) => [
        match.route.id,
        await match.resolve(async (handler) => {
          if (!batch || !servers.has(match.route.id)) {
            return handler();
          }
          const body = await batch;
          if ("redirect" in body) {
            throw redirectTo(body);
          }
          return unpack(body.results[match.route.id]);
        }),
      ]),
    );
    return Object.fromEntries(results);
  };
}

function toRouteObject(route: ClientRoute, servers: Set<string>): RouteObject {
  if (route.server) {
    servers.add(route.id);
  }
  const children = route.children?.map((child) =>
    toRouteObject(child, servers),
  );
  const common = {
    id: route.id,
    ...(route.server
      ? { loader: serverLoader, action: serverAction(route.id) }
      : {}),
    lazy: async () => {
      const page = await route.page();
      return {
        ...(page.default ? { Component: page.default } : {}),
        ...(page.ErrorBoundary
          ? { ErrorBoundary: errorBoundary(page.ErrorBoundary) }
          : {}),
        handle: { ...page.handle, meta: page.meta },
      };
    },
  };
  return route.index
    ? { ...common, index: true }
    : {
        ...common,
        ...(route.path === undefined ? {} : { path: route.path }),
        ...(children ? { children } : {}),
      };
}

/**
 * Sets the document title from the deepest route whose `meta` names one. A
 * layout effect runs before every page's effects, so a page that sets the
 * title itself (the UI's `Page`) still has the last word.
 */
function DocumentTitle({ fallback }: { fallback: string }) {
  const matches = useMatches();
  const location = useLocation();
  useLayoutEffect(() => {
    for (const match of [...matches].reverse()) {
      const meta = (match.handle as { meta?: MetaFunctionLike } | undefined)
        ?.meta;
      const title = meta?.({ data: match.loaderData, params: match.params })
        ?.map((descriptor) => (descriptor as { title?: unknown }).title)
        .find((value) => value !== undefined);
      if (title !== undefined) {
        document.title = String(title);
        return;
      }
    }
    document.title = fallback;
  }, [matches, location, fallback]);
  return null;
}

const Empty = () => null;

/** Renders the app into `#root`. */
export function startApp(app: AppDefinition): void {
  const servers = new Set<string>();
  const Root = app.root.default ?? Empty;
  const fallback = document.title;
  if (app.rootServer) {
    servers.add("root");
  }
  const router = createBrowserRouter(
    [
      {
        id: "root",
        path: "/",
        Component: () => (
          <>
            <DocumentTitle fallback={fallback} />
            <ScrollRestoration />
            <Root />
          </>
        ),
        ...(app.root.ErrorBoundary
          ? { ErrorBoundary: errorBoundary(app.root.ErrorBoundary) }
          : {}),
        HydrateFallback: app.root.HydrateFallback ?? Empty,
        handle: { ...app.root.handle, meta: app.root.meta },
        ...(app.rootServer
          ? { loader: serverLoader, action: serverAction("root") }
          : {}),
        children: app.routes.map((route) => toRouteObject(route, servers)),
      },
    ],
    { dataStrategy: createDataStrategy(servers) },
  );
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("index.html has no #root element");
  }
  createRoot(container).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
