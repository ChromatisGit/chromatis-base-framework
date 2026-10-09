import type { ServerBuild } from "react-router";
import { createRequestHandler } from "react-router";
import { createBunRuntimeHost } from "./stateful/bun.js";
import {
  createCloudflareRuntimeHost,
  type DurableObjectNamespaceLike,
} from "./stateful/cloudflare.js";
import type { RuntimeDefinition, StatefulRuntime } from "./stateful.js";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

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

export function createFrameworkWorker<Service>(
  build: ServerBuild,
  hook: ServerHook<Service> | undefined,
  bindings: Readonly<Record<string, string>>,
) {
  const handle = createRequestHandler(build, "production");
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
        service = hook.createService(runtime, directoryEnvironment(env));
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
      return handle(new Request(request, { headers }));
    },
  };
}

function directoryEnvironment(
  source: Record<string, unknown>,
): Record<string, string | undefined> {
  const result = Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  if (!(result.DIRECTORY_URL && result.DIRECTORY_KEY && result.PUBLIC_URL)) {
    delete result.DIRECTORY_URL;
    delete result.DIRECTORY_KEY;
    delete result.PUBLIC_URL;
  }
  return result;
}

function staticFile(root: string, pathname: string): Response | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const file = path.resolve(root, `.${decoded}`);
  if (
    !file.startsWith(`${root}${path.sep}`) ||
    !existsSync(file) ||
    !statSync(file).isFile()
  ) {
    return undefined;
  }
  return new Response(Bun.file(file), {
    headers: {
      "Cache-Control": pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    },
  });
}

export async function startFrameworkBun<Service>(
  hook?: ServerHook<Service>,
): Promise<void> {
  const root = process.cwd();
  const build = (await import(
    path.join(root, "build/server/index.js")
  )) as ServerBuild;
  const handle = createRequestHandler(build, "production");
  const host = createBunRuntimeHost(hook?.definitions ?? []);
  const service = hook?.createService(host, directoryEnvironment(process.env));
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
      return handle(new Request(request, { headers }));
    },
    websocket: host.websocket as never,
  });
  host.attachServer(server as never);
  console.info(`Listening on http://localhost:${server.port}`);
}
