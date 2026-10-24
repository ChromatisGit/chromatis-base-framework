import { DEV_OPEN_VARIABLE } from "./dev.js";
import { createBunRuntimeHost } from "./stateful/bun.js";
import type { RuntimeDefinition, StatefulRuntime } from "./stateful.js";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { withRequestScope } from "./request-scope.js";
import { handleApi, type ApiTable } from "./api.js";
import { handleData, type DataTable } from "./data.js";

/** The generated route tables (`.chromatis/build/routes.ts`). */
export type ServerRoutes = Readonly<{ api: ApiTable; data: DataTable }>;

/** Data and API requests, inside a request scope; undefined for anything else. */
export function serveRoutes(
  routes: ServerRoutes,
  request: Request,
): Promise<Response | undefined> {
  return withRequestScope(
    async () =>
      (await handleData(routes.data, request)) ??
      (await handleApi(routes.api, request)),
  );
}

export interface ServerHook<Service = unknown> {
  readonly definitions: readonly RuntimeDefinition[];
  createService(
    host: StatefulRuntime,
    env: Readonly<Record<string, string | undefined>>,
  ): Service;
  readonly realtimeRoute?: string;
  socket?(request: Request, service: Service): Promise<Response | undefined>;
  sweep?(service: Service): void | Promise<void>;
}

/** The string-valued bindings and environment variables, as the hook sees them. */
export function stringEnvironment(
  source: Record<string, unknown>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[0] !== DEV_OPEN_VARIABLE,
    ),
  );
}

function staticFile(root: string, pathname: string): Response | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const requested = path.resolve(root, `.${decoded}`);
  // A prerendered page is `<path>.html`, as Cloudflare's assets serve it.
  const file = [requested, `${requested}.html`].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  if (!requested.startsWith(`${root}${path.sep}`) || !file) {
    return undefined;
  }
  return new Response(Bun.file(file), {
    headers: {
      "Cache-Control": pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : file.endsWith(".html")
          ? "no-cache"
          : "public, max-age=3600",
    },
  });
}

export async function startFrameworkBun<Service>(
  routes: ServerRoutes,
  hook?: ServerHook<Service>,
): Promise<void> {
  const root = process.cwd();
  const host = createBunRuntimeHost(hook?.definitions ?? []);
  // A deployed server is never a `--open` development server.
  delete process.env[DEV_OPEN_VARIABLE];
  const service = hook?.createService(host, stringEnvironment(process.env));
  if (hook?.sweep && service !== undefined) {
    setInterval(() => void hook.sweep?.(service), 60_000).unref();
  }
  const clientRoot = path.resolve(root, "build/client");
  const server = Bun.serve({
    port: Number(process.env.PORT ?? 3000),
    async fetch(request, serverRef) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/_chromatis/health") {
        return new Response("ok");
      }
      if (
        hook?.realtimeRoute === pathname &&
        hook.socket &&
        service !== undefined
      ) {
        return hook.socket(request, service);
      }
      const asset =
        request.method === "GET" ? staticFile(clientRoot, pathname) : undefined;
      if (asset) {
        return asset;
      }
      const headers = new Headers(request.headers);
      const forwarded = request.headers
        .get("x-forwarded-for")
        ?.split(",")[0]
        ?.trim();
      const address = serverRef.requestIP(request)?.address ?? "local";
      headers.set(
        "x-chromatis-client",
        process.env.TRUST_PROXY === "1" && forwarded ? forwarded : address,
      );
      const answer = await serveRoutes(
        routes,
        new Request(request, { headers }),
      );
      if (answer) {
        return answer;
      }
      // Every other GET is a page: the browser app routes it.
      return request.method === "GET" || request.method === "HEAD"
        ? new Response(Bun.file(path.join(clientRoot, "index.html")), {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          })
        : new Response(null, { status: 404 });
    },
    websocket: host.websocket as never,
  });
  host.attachServer(server as never);
  console.info(`Listening on http://localhost:${server.port}`);
}
