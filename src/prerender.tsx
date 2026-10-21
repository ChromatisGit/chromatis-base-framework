/**
 * Prerendering: a page declared with `prerender: true` is rendered to HTML at
 * build time, from the same route tree the browser builds (client.tsx) and
 * with its server loaders answered in-process, as for a visitor without
 * cookies. The browser hydrates that HTML (see `startApp`). Runs in Vite's
 * server environment during `chromatis build` (infra/scripts/prerender.ts).
 */
import { renderToString } from "react-dom/server";
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from "react-router";
import {
  createDataStrategy,
  createRoutes,
  documentMeta,
  type AppDefinition,
} from "./client.js";
import type { Prerendered } from "./data-protocol.js";
import { serveRoutes, type ServerRoutes } from "./server.js";

export type PrerenderedPage = Readonly<{
  /** The markup inside `#root`. */
  html: string;
  title: string | undefined;
  description: string | undefined;
  /** The ids of the matched routes, root first. */
  routes: readonly string[];
  state: Prerendered;
}>;

/** Renders `url` (absolute; its origin is what the loaders see). */
export async function prerenderPage(
  app: AppDefinition,
  tables: ServerRoutes,
  url: string,
): Promise<PrerenderedPage> {
  const { routes, servers } = createRoutes(app);
  const handler = createStaticHandler(routes);
  const fetchData = async (target: string, init: RequestInit) =>
    (await serveRoutes(tables, new Request(target, init))) ??
    new Response(null, { status: 404 });
  const context = await handler.query(new Request(url), {
    dataStrategy: createDataStrategy(servers, fetchData),
  });
  if (context instanceof Response) {
    throw new Error(
      `${url} answers ${context.status}${context.headers.has("Location") ? ` (redirect to ${context.headers.get("Location")})` : ""}; a prerendered page must render`,
    );
  }
  if (context.errors) {
    throw new Error(
      `${url}: ${Object.entries(context.errors)
        .map(([id, error]) => `route ${id}: ${describe(error)}`)
        .join("; ")}`,
    );
  }
  const html = renderToString(
    <StaticRouterProvider
      router={createStaticRouter(handler.dataRoutes, context)}
      context={context}
      hydrate={false}
    />,
  );
  const meta = documentMeta(
    context.matches.map((match) => ({
      handle: match.route.handle,
      data: context.loaderData[match.route.id],
      params: match.params,
    })),
  );
  return {
    html,
    title: meta.title,
    description: meta.description,
    routes: context.matches.map((match) => match.route.id),
    state: {
      path: new URL(url).pathname,
      hydrationData: { loaderData: context.loaderData },
    },
  };
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "status" in error) {
    return `status ${String((error as { status: unknown }).status)}`;
  }
  return String(error);
}
