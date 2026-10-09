import {
  createCloudflareRuntimeHost,
  createRuntimeDurableObject,
} from "./cloudflare.js";
import { observed, roomDefinition } from "./contract.fixture.js";
import type { RuntimeAddress, RuntimeJson } from "./contract.js";

// Entry point bundled for workerd by workerd.test.ts; not part of the package.
export const RuntimeInstanceObject = createRuntimeDurableObject([
  roomDefinition,
]);

type Env = { RUNTIME_OBJECTS: never };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const host = createCloudflareRuntimeHost(env.RUNTIME_OBJECTS, [
      roomDefinition,
    ]);
    const url = new URL(request.url);
    const [, op = "", kind = "", id = ""] = url.pathname
      .split("/")
      .map(decodeURIComponent);
    const address: RuntimeAddress = { kind, id };
    try {
      switch (op) {
        case "create":
          await host.create(address, (await request.json()) as RuntimeJson);
          return Response.json({ result: null });
        case "exists":
          return Response.json({ result: await host.exists(address) });
        case "command":
          return Response.json({
            result: await host.command(
              address,
              (await request.json()) as RuntimeJson,
            ),
          });
        case "close":
          await host.close(address);
          return Response.json({ result: null });
        case "connect":
          return (
            (await host.connect(address, request)) ??
            new Response(null, { status: 500 })
          );
        case "closes":
          return Response.json(observed.closes);
        default:
          return new Response("not found", { status: 404 });
      }
    } catch (error) {
      const e = error as { code?: string; message?: string };
      return Response.json(
        {
          error: { code: e.code ?? "internal_error", message: e.message ?? "" },
        },
        {
          status: 400,
          // Bodies of failed upgrade responses are dropped; mirror in headers.
          headers: {
            "x-error-code": e.code ?? "internal_error",
            "x-error-message": e.message ?? "",
          },
        },
      );
    }
  },
};
