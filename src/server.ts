import { DEV_OPEN_VARIABLE } from "./dev.js";
import { createBunRuntimeHost } from "./stateful/bun.js";
import type { RuntimeDefinition, StatefulRuntime } from "./stateful.js";
import { existsSync, readdirSync } from "node:fs";
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

/**
 * Serves the built client files. The build output does not change while the
 * server runs, so the file list is read once at startup and a request costs a
 * lookup instead of file-system calls.
 */
export function createStaticFiles(
  root: string,
): (pathname: string) => Response | undefined {
  const files = new Set(
    existsSync(root)
      ? readdirSync(root, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) =>
            path.relative(root, path.join(entry.parentPath, entry.name)),
          )
      : [],
  );
  return (pathname) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname).slice(1);
    } catch {
      return undefined;
    }
    // A prerendered page is `<path>.html`, as Cloudflare's assets serve it.
    const file = [decoded, `${decoded}.html`].find((candidate) =>
      files.has(candidate),
    );
    if (!file) {
      return undefined;
    }
    return new Response(Bun.file(path.join(root, file)), {
      headers: {
        "Cache-Control": pathname.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : file.endsWith(".html")
            ? "no-cache"
            : "public, max-age=3600",
      },
    });
  };
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
  const staticFile = createStaticFiles(clientRoot);
  const trustProxy = process.env.TRUST_PROXY === "1";
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
      const asset = request.method === "GET" ? staticFile(pathname) : undefined;
      if (asset) {
        return asset;
      }
      const forwarded = trustProxy
        ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        : undefined;
      // Bun's incoming headers are mutable: set in place, no copies. This
      // also replaces a value the client sent itself.
      request.headers.set(
        "x-chromatis-client",
        forwarded || (serverRef.requestIP(request)?.address ?? "local"),
      );
      const answer = await serveRoutes(routes, request);
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
