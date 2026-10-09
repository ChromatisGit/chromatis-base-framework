import { Miniflare } from "miniflare";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type AppError,
} from "../errors.js";
import type {
  RuntimeAddress,
  RuntimeJson,
  StatefulRuntime,
} from "./contract.js";
import { runRuntimeContractTests } from "./contract.suite.js";

/** Runs the contract against the real Durable Object class inside workerd. */
runRuntimeContractTests("Cloudflare Runtime Host (workerd)", async () => {
  const built = await Bun.build({
    entrypoints: [new URL("./workerd.entry.ts", import.meta.url).pathname],
    target: "browser",
    format: "esm",
    minify: false,
  });
  if (!built.success) {
    throw new Error(built.logs.join("\n"));
  }
  const script = await (built.outputs[0] as { text(): Promise<string> }).text();

  const mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2025-01-01",
    durableObjects: { RUNTIME_OBJECTS: "RuntimeInstanceObject" },
  });
  await mf.ready;

  const errors: Record<string, new (m: string) => AppError> = {
    not_found: NotFoundError,
    conflict: ConflictError,
    validation_failed: ValidationError,
  };
  async function call(
    op: string,
    a: RuntimeAddress,
    body?: RuntimeJson,
  ): Promise<RuntimeJson> {
    const res = await mf.dispatchFetch(
      `http://worker/${op}/${encodeURIComponent(a.kind)}/${encodeURIComponent(a.id)}`,
      {
        method: "POST",
        body: JSON.stringify(body ?? null),
      },
    );
    const json = (await res.json()) as {
      result?: RuntimeJson;
      error?: { code: string; message: string };
    };
    if (json.error) {
      const make = errors[json.error.code];
      throw make ? new make(json.error.message) : new Error(json.error.message);
    }
    return json.result ?? null;
  }

  const runtime: StatefulRuntime = {
    target: "cloudflare",
    create: async (a, init = null) => void (await call("create", a, init)),
    exists: async (a) => (await call("exists", a)) === true,
    command: (a, c) => call("command", a, c),
    close: async (a) => void (await call("close", a)),
    connect: async (a, request) => {
      const res = await mf.dispatchFetch(
        `http://worker/connect/${encodeURIComponent(a.kind)}/${encodeURIComponent(a.id)}`,
        { headers: Object.fromEntries(request.headers) },
      );
      if (res.status === 400) {
        const make = errors[res.headers.get("x-error-code") ?? ""];
        const message = res.headers.get("x-error-message") ?? "";
        throw make ? new make(message) : new Error(message);
      }
      return res as unknown as Response;
    },
  };

  return {
    runtime,
    async open(address, params = {}) {
      const query = new URLSearchParams(params).toString();
      const res = await mf.dispatchFetch(
        `http://worker/connect/${address.kind}/${address.id}?${query}`,
        {
          headers: { upgrade: "websocket" },
        },
      );
      const ws = res.webSocket;
      if (!ws) {
        throw new Error(`upgrade failed: ${res.status} ${await res.text()}`);
      }
      ws.accept();
      return ws as never;
    },
    async closes() {
      const list = (await (
        await mf.dispatchFetch("http://worker/closes/x/y")
      ).json()) as (string | null)[];
      return list.map((reason) => reason ?? undefined);
    },
    async dispose() {
      await mf.dispose();
    },
  };
});
