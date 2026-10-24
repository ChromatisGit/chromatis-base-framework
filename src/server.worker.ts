import {
  createCloudflareRuntimeHost,
  type DurableObjectNamespaceLike,
} from "./stateful/cloudflare.js";
import {
  serveRoutes,
  stringEnvironment,
  type ServerHook,
  type ServerRoutes,
} from "./server.js";

/*
 * The Cloudflare Worker entry. The Cloudflare host is frozen: it keeps
 * working, but the Bun server (`server.ts`) no longer imports or pays for it.
 */

export function createFrameworkWorker<Service>(
  routes: ServerRoutes,
  hook: ServerHook<Service> | undefined,
  bindings: Readonly<Record<string, string>>,
) {
  return {
    async fetch(
      request: Request,
      env: Record<string, unknown>,
    ): Promise<Response> {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/_chromatis/health") {
        return new Response("ok");
      }
      let service: Service | undefined;
      if (hook) {
        const namespaces = Object.fromEntries(
          Object.entries(bindings).map(([kind, binding]) => [
            kind,
            env[binding] as DurableObjectNamespaceLike,
          ]),
        );
        const runtime = createCloudflareRuntimeHost(
          namespaces,
          hook.definitions,
        );
        service = hook.createService(runtime, stringEnvironment(env));
      }
      if (
        hook &&
        hook.realtimeRoute === pathname &&
        hook.socket &&
        service !== undefined
      ) {
        return (
          (await hook.socket(request, service)) ??
          new Response(null, { status: 500 })
        );
      }
      const headers = new Headers(request.headers);
      headers.delete("x-chromatis-client");
      headers.set(
        "x-chromatis-client",
        request.headers.get("cf-connecting-ip") ?? "local",
      );
      // Static files and pages never get here (see `run_worker_first`).
      return (
        (await serveRoutes(routes, new Request(request, { headers }))) ??
        new Response(null, { status: 404 })
      );
    },
  };
}
