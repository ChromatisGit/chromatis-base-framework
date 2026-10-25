/**
 * The browser side of a Chromatis app: the generated entry calls `startApp`
 * with the route tree. Pages render in the browser; the loaders and actions of
 * their server files run on the server, and one request per navigation
 * fetches every server loader it needs (see data-protocol.ts). A page that was
 * prerendered at build time (prerender.tsx) is hydrated instead.
 */
import { StrictMode, useLayoutEffect, type ComponentType } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import {
  createBrowserRouter,
  matchRoutes,
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
  COOKIES_HEADER,
  DATA_PREFIX,
  ROUTE_PARAM,
  ROUTES_PARAM,
  SHELL_ATTRIBUTE,
  type DataResponse,
  type DataResult,
  type Prerendered,
} from "./data-protocol.js";
import {
  activateWaitingVersion,
  forgetOfflineData,
  registerServiceWorker,
} from "./offline.js";

export { updateApp } from "./offline.js";

/** What a page file exports. */
export type PageModule = Readonly<{
  default?: ComponentType;
  /** Receives the error as a prop, as in React Router's framework mode. */
  ErrorBoundary?: ComponentType<{ error: unknown }>;
  HydrateFallback?: ComponentType;
  meta?: MetaFunctionLike;
  handle?: Record<string, unknown>;
  /**
   * Runs in the browser after the route's server loader, with its data, and
   * its result is what the page reads (`useLoaderData`). For data the server
   * only points to, such as immutable files the browser fetches itself. Not
   * run for prerendered pages at build time.
   */
  clientLoader?: ClientLoader;
}>;

export type ClientLoaderArgs = Readonly<{
  /** The server loader's data; null for a route without a server file. */
  data: unknown;
  params: Readonly<Record<string, string | undefined>>;
  request: Request;
}>;

export type ClientLoader = (args: ClientLoaderArgs) => unknown;

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
  /** The document's title, for pages whose `meta` names none. */
  title: string;
  /** The build has a service worker (`document.serviceWorker`). */
  serviceWorker?: boolean;
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
  if (response.headers.has(COOKIES_HEADER)) {
    forgetOfflineData();
  }
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

/** How data requests reach the server: `fetch`, or the server in-process. */
export type FetchData = (url: string, init: RequestInit) => Promise<Response>;

const browserFetch: FetchData = (url, init) => fetch(url, init);

async function loadServer(
  fetchData: FetchData,
  request: Request,
  ids: readonly string[],
): Promise<DataResponse> {
  return readData(
    await fetchData(dataUrl(request.url, ROUTES_PARAM, ids.join(",")), {
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

/** A route's page file, by route id: where the data strategy finds client loaders. */
export type PageFiles = ReadonlyMap<string, () => Promise<PageModule>>;

export function createDataStrategy(
  servers: ReadonlySet<string>,
  fetchData: FetchData = browserFetch,
  pages: PageFiles = new Map(),
): DataStrategyFunction {
  return async ({ request, matches }) => {
    const pending = matches.filter((match) => match.shouldCallHandler());
    const ids =
      request.method === "GET"
        ? pending
            .filter((match) => servers.has(match.route.id))
            .map((match) => match.route.id)
        : [];
    const batch = ids.length ? loadServer(fetchData, request, ids) : undefined;
    // Kept from rejecting unobserved; every server match awaits it below.
    batch?.catch(() => undefined);
    const results = await Promise.all(
      pending.map(async (match) => [
        match.route.id,
        await match.resolve(async (handler) => {
          let data: unknown;
          if (!batch || !servers.has(match.route.id)) {
            data = await handler();
          } else {
            const body = await batch;
            if ("redirect" in body) {
              throw redirectTo(body);
            }
            data = unpack(body.results[match.route.id]);
          }
          if (request.method !== "GET") {
            return data;
          }
          // The router loads a lazy page while the server answers, so the
          // client loader is looked up in the page file itself. Without
          // `pages` (prerendering at build time) none runs.
          const page = pages.get(match.route.id);
          const clientLoader = page && (await page()).clientLoader;
          return clientLoader
            ? clientLoader({ data, params: match.params, request })
            : data;
        }),
      ]),
    );
    return Object.fromEntries(results);
  };
}

/** What the router needs from a page file. */
function pageRoute(page: PageModule, server: boolean) {
  return {
    // Without a server file the router calls no loader unless there is one.
    ...(page.clientLoader && !server ? { loader: serverLoader } : {}),
    ...(page.default ? { Component: page.default } : {}),
    ...(page.ErrorBoundary
      ? { ErrorBoundary: errorBoundary(page.ErrorBoundary) }
      : {}),
    handle: { ...page.handle, meta: page.meta },
  };
}

function toRouteObject(
  route: ClientRoute,
  servers: Set<string>,
  loaded: ReadonlyMap<string, PageModule>,
): RouteObject {
  if (route.server) {
    servers.add(route.id);
  }
  const children = route.children?.map((child) =>
    toRouteObject(child, servers, loaded),
  );
  const page = loaded.get(route.id);
  const common = {
    id: route.id,
    ...(route.server
      ? { loader: serverLoader, action: serverAction(route.id) }
      : {}),
    ...(page
      ? pageRoute(page, !!route.server)
      : { lazy: async () => pageRoute(await route.page(), !!route.server) }),
  };
  return route.index
    ? { ...common, index: true }
    : {
        ...common,
        ...(route.path === undefined ? {} : { path: route.path }),
        ...(children ? { children } : {}),
      };
}

/** A matched route as `meta` sees it. */
type MetaMatch = Readonly<{
  handle?: unknown;
  data: unknown;
  params: Readonly<Record<string, string | undefined>>;
}>;

/** The title and description of the deepest routes whose `meta` names them. */
export function documentMeta(matches: readonly MetaMatch[]): {
  title?: string;
  description?: string;
} {
  const found: { title?: string; description?: string } = {};
  for (const match of [...matches].reverse()) {
    const meta = (match.handle as { meta?: MetaFunctionLike } | undefined)
      ?.meta;
    for (const descriptor of meta?.({
      data: match.data,
      params: match.params,
    }) ?? []) {
      const { title, name, content } = descriptor as {
        title?: unknown;
        name?: unknown;
        content?: unknown;
      };
      if (title !== undefined) {
        found.title ??= String(title);
      }
      if (name === "description" && content !== undefined) {
        found.description ??= String(content);
      }
    }
  }
  return found;
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
    document.title =
      documentMeta(
        matches.map((match) => ({ ...match, data: match.loaderData })),
      ).title ?? fallback;
  }, [matches, location, fallback]);
  return null;
}

const Empty = () => null;

/**
 * The router's route tree, and the ids of the routes with a server file. Pages
 * in `loaded` are in place; the others load when a navigation needs them.
 */
export function createRoutes(
  app: AppDefinition,
  loaded: ReadonlyMap<string, PageModule> = new Map(),
): { routes: RouteObject[]; servers: Set<string>; pages: PageFiles } {
  const servers = new Set<string>(app.rootServer ? ["root"] : []);
  const pages = new Map<string, () => Promise<PageModule>>([
    ["root", async () => app.root],
  ]);
  const collect = (list: readonly ClientRoute[]) => {
    for (const route of list) {
      pages.set(route.id, route.page);
      collect(route.children ?? []);
    }
  };
  collect(app.routes);
  const Root = app.root.default ?? Empty;
  const routes: RouteObject[] = [
    {
      id: "root",
      path: "/",
      Component: () => (
        <>
          <DocumentTitle fallback={app.title} />
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
      children: app.routes.map((route) =>
        toRouteObject(route, servers, loaded),
      ),
    },
  ];
  return { routes, servers, pages };
}

function routeIndex(
  routes: readonly ClientRoute[],
  index = new Map<string, ClientRoute>(),
): Map<string, ClientRoute> {
  for (const route of routes) {
    index.set(route.id, route);
    routeIndex(route.children ?? [], index);
  }
  return index;
}

/** The pages of the routes `path` matches, loaded, so hydration needs no wait. */
async function pagesFor(
  app: AppDefinition,
  path: string,
): Promise<Map<string, PageModule>> {
  const index = routeIndex(app.routes);
  const matched = matchRoutes(createRoutes(app).routes, path) ?? [];
  return new Map(
    await Promise.all(
      matched.flatMap(({ route }) => {
        const declared =
          route.id === undefined ? undefined : index.get(route.id);
        return declared
          ? [declared.page().then((page) => [declared.id, page] as const)]
          : [];
      }),
    ),
  );
}

declare global {
  interface Window {
    __chromatisPrerender?: Prerendered;
  }
}

/** The running app's routes, for `preloadPage`. */
let running:
  { routes: RouteObject[]; servers: ReadonlySet<string> } | undefined;

/**
 * Loads a page's server data ahead of a visit, so the service worker keeps
 * it and the page opens without a network. Resolves false if it failed.
 */
export async function preloadPage(path: string): Promise<boolean> {
  if (!running) {
    return false;
  }
  const { routes, servers } = running;
  const ids = (matchRoutes(routes, path) ?? []).flatMap(({ route }) =>
    route.id !== undefined && servers.has(route.id) ? [route.id] : [],
  );
  if (!ids.length) {
    return true;
  }
  try {
    const page = new URL(path, window.location.origin).href;
    const response = await fetch(dataUrl(page, ROUTES_PARAM, ids.join(",")), {
      headers: { Accept: "application/json" },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Vite sets `PROD` (a boolean) in a build; Bun's tests see strings or nothing. */
const production = (): boolean => String(import.meta.env?.PROD) === "true";

/**
 * Renders the app into `#root`, or hydrates it when the page was prerendered
 * for this path. Hydration uses the build's data; the visitor's own (cookies,
 * releases) replaces it right after. With a service worker, a version that
 * is waiting becomes active first.
 */
export async function startApp(app: AppDefinition): Promise<void> {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("index.html has no #root element");
  }
  const offline = app.serviceWorker === true && production();
  if (offline && (await activateWaitingVersion())) {
    return;
  }
  const prerendered = window.__chromatisPrerender;
  const hydrate = prerendered?.path === window.location.pathname;
  const { routes, servers, pages } = createRoutes(
    app,
    hydrate ? await pagesFor(app, window.location.pathname) : undefined,
  );
  const router = createBrowserRouter(routes, {
    dataStrategy: createDataStrategy(servers, browserFetch, pages),
    ...(hydrate ? { hydrationData: prerendered.hydrationData } : {}),
  });
  running = { routes, servers };
  if (offline) {
    registerServiceWorker();
  }
  const tree = (
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
  if (hydrate) {
    hydrateRoot(container, tree);
    void router.revalidate();
    return;
  }
  container.replaceChildren();
  document.documentElement.removeAttribute(SHELL_ATTRIBUTE);
  createRoot(container).render(tree);
}
