import {
  AppError,
  ConflictError,
  NotFoundError,
  UnauthenticatedError,
  PermissionDeniedError,
  ValidationError,
} from "../errors.js";
import {
  assertValidAddress,
  connectionParams,
  indexDefinitions,
  type RuntimeAddress,
  type RuntimeDefinition,
  type RuntimeJson,
  type StatefulRuntime,
} from "./contract.js";
import { RuntimeInstance, roundTrip } from "./instance.js";

/*
 * Cloudflare specifics stay in this file. The Worker-side host talks to one
 * Durable Object per Runtime Instance over plain fetch; the Durable Object
 * delegates to the shared RuntimeInstance, so behavior matches the Bun host.
 * Only structural types are used so no Cloudflare package is imported.
 */

export interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

type WorkerSocket = {
  accept(): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "message" | "close" | "error",
    listener: (event: { data?: unknown }) => void,
  ): void;
};

type WorkerSocketPairConstructor = new () => {
  0: WorkerSocket;
  1: WorkerSocket;
};

const KIND_HEADER = "x-chromatis-runtime-kind";
const ID_HEADER = "x-chromatis-runtime-id";
const ORIGIN = "https://chromatis-runtime.internal";

const ERRORS: Record<string, (message: string) => AppError> = {
  not_found: (message) => new NotFoundError(message),
  conflict: (message) => new ConflictError(message),
  validation_failed: (message) => new ValidationError(message),
  unauthenticated: (message) => new UnauthenticatedError(message),
  permission_denied: (message) => new PermissionDeniedError(message),
};

function fail(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: 400 },
    );
  }
  console.error(error);
  return Response.json(
    { error: { code: "internal_error", message: "Internal server error" } },
    { status: 500 },
  );
}

async function unwrap(response: Response): Promise<RuntimeJson> {
  const body = (await response.json()) as {
    result?: RuntimeJson;
    error?: { code: string; message: string };
  };
  const failure = body.error;
  if (failure) {
    const make =
      ERRORS[failure.code] ??
      ((message: string) => new AppError(message, failure.code));
    throw make(failure.message);
  }
  if (!response.ok) {
    throw new Error("Runtime Durable Object failed");
  }
  return body.result ?? null;
}

/** Worker-side Stateful Runtime backed by a Durable Object namespace. */
export function createCloudflareRuntimeHost(
  namespace:
    | DurableObjectNamespaceLike
    | Readonly<Record<string, DurableObjectNamespaceLike>>,
  definitions: readonly RuntimeDefinition[],
): StatefulRuntime {
  const known = indexDefinitions(definitions);

  function stub(address: RuntimeAddress): DurableObjectStubLike {
    assertValidAddress(address);
    if (!known.has(address.kind)) {
      throw new NotFoundError(`Unknown runtime kind "${address.kind}"`);
    }
    const selected: DurableObjectNamespaceLike | undefined =
      typeof (namespace as DurableObjectNamespaceLike).idFromName === "function"
        ? (namespace as DurableObjectNamespaceLike)
        : (namespace as Readonly<Record<string, DurableObjectNamespaceLike>>)[
            address.kind
          ];
    if (!selected) {
      throw new NotFoundError(`No runtime binding for kind "${address.kind}"`);
    }
    return selected.get(selected.idFromName(`${address.kind}/${address.id}`));
  }

  function call(
    address: RuntimeAddress,
    operation: string,
    body?: RuntimeJson,
  ): Promise<Response> {
    return stub(address).fetch(
      new Request(`${ORIGIN}/${operation}`, {
        method: "POST",
        headers: { [KIND_HEADER]: address.kind, [ID_HEADER]: address.id },
        body: JSON.stringify(body ?? null),
      }),
    );
  }

  return {
    target: "cloudflare",
    async create(address, init = null) {
      await unwrap(await call(address, "create", roundTrip(init)));
    },
    async exists(address) {
      return (await unwrap(await call(address, "exists"))) === true;
    },
    async command(address, command) {
      return unwrap(await call(address, "command", roundTrip(command)));
    },
    async close(address) {
      await unwrap(await call(address, "close"));
    },
    async connect(address, request, trusted) {
      const target = stub(address);
      const headers = new Headers(request.headers);
      headers.set(KIND_HEADER, address.kind);
      headers.set(ID_HEADER, address.id);
      const query = new URLSearchParams(connectionParams(request, trusted));
      const response = await target.fetch(
        new Request(`${ORIGIN}/connect?${query}`, {
          method: "GET",
          headers,
        }),
      );
      if (
        !response.ok &&
        response.headers.get("content-type")?.includes("json")
      ) {
        await unwrap(response);
      }
      return response;
    },
  };
}

type DurableObjectStateLike = unknown;

/** Seam for the platform primitives; defaults to the Workers globals. */
export interface RuntimeDurableObjectPlatform {
  WebSocketPair: WorkerSocketPairConstructor;
  upgradeResponse(client: WorkerSocket): Response;
}

const workersPlatform: RuntimeDurableObjectPlatform = {
  get WebSocketPair() {
    const Pair = (globalThis as { WebSocketPair?: WorkerSocketPairConstructor })
      .WebSocketPair;
    if (!Pair) {
      throw new Error("WebSocketPair is not available");
    }
    return Pair;
  },
  upgradeResponse: (client) =>
    new Response(null, { status: 101, webSocket: client } as ResponseInit),
};

class RuntimeObjectCore {
  private instance: RuntimeInstance | undefined;
  private starting = false;

  constructor(
    private readonly known: ReadonlyMap<string, RuntimeDefinition>,
    private readonly platform: RuntimeDurableObjectPlatform,
  ) {}

  private open(): RuntimeInstance | undefined {
    return this.instance && !this.instance.isClosed ? this.instance : undefined;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      return await this.route(request);
    } catch (error) {
      return fail(error);
    }
  }

  private async route(request: Request): Promise<Response> {
    const address: RuntimeAddress = {
      kind: request.headers.get(KIND_HEADER) ?? "",
      id: request.headers.get(ID_HEADER) ?? "",
    };
    assertValidAddress(address);
    const operation = new URL(request.url).pathname.slice(1);
    const ok = (result: RuntimeJson): Response => Response.json({ result });

    switch (operation) {
      case "create": {
        const definition = this.known.get(address.kind);
        if (!definition) {
          throw new NotFoundError(`Unknown runtime kind "${address.kind}"`);
        }
        if (this.open() || this.starting) {
          throw new ConflictError(
            `Runtime instance ${address.kind}/${address.id} already exists`,
          );
        }
        this.starting = true;
        try {
          const init = (await request.json()) as RuntimeJson;
          const instance = await RuntimeInstance.start(
            definition,
            address,
            init,
            () => {
              if (this.instance === instance) {
                this.instance = undefined;
              }
            },
          );
          this.instance = instance;
        } finally {
          this.starting = false;
        }
        return ok(null);
      }
      case "exists":
        return ok(this.open() !== undefined);
      case "command":
        return ok(
          await this.require(address).command(
            (await request.json()) as RuntimeJson,
          ),
        );
      case "close":
        await this.open()?.close();
        return ok(null);
      case "connect":
        return this.connect(address, request);
      default:
        throw new NotFoundError("Unknown runtime operation");
    }
  }

  private require(address: RuntimeAddress): RuntimeInstance {
    const instance = this.open();
    if (!instance) {
      throw new NotFoundError(
        `Unknown runtime instance ${address.kind}/${address.id}`,
      );
    }
    return instance;
  }

  private connect(address: RuntimeAddress, request: Request): Response {
    const instance = this.require(address);
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const pair = new this.platform.WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const { id } = instance.attach(
      {
        send: (data) => server.send(data),
        close: (code, reason) => server.close(code, reason),
      },
      params,
    );
    server.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        void instance.message(id, event.data);
      } else {
        server.close(1003, "text frames only");
      }
    });
    const disconnect = (): void => void instance.disconnect(id);
    server.addEventListener("close", disconnect);
    server.addEventListener("error", disconnect);
    return this.platform.upgradeResponse(client);
  }
}

/**
 * Builds the Durable Object class to export from the Worker entry:
 * `export const RuntimeInstanceObject = createRuntimeDurableObject([...])`.
 * One object holds at most one Runtime Instance. State is memory-only; the
 * WebSocket is accepted without hibernation so the object stays resident
 * while connections are open.
 */
export function createRuntimeDurableObject(
  definitions: readonly RuntimeDefinition[],
  platform: RuntimeDurableObjectPlatform = workersPlatform,
): new (
  state: DurableObjectStateLike,
  env: unknown,
) => {
  fetch(request: Request): Promise<Response>;
} {
  const known = indexDefinitions(definitions);
  return class RuntimeInstanceObject extends RuntimeObjectCore {
    constructor(_state: DurableObjectStateLike, _env: unknown) {
      super(known, platform);
    }
  };
}
