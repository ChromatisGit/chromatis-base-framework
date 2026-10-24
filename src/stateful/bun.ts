import { ConflictError, NotFoundError } from "../errors.js";
import {
  assertValidAddress,
  connectionParams,
  indexDefinitions,
  type RuntimeAddress,
  type RuntimeDefinition,
  type RuntimeJson,
  type StatefulRuntime,
} from "./contract.js";
import { RuntimeInstance } from "./instance.js";

type SocketData = {
  key: string;
  connectionId: string | undefined;
  params: Record<string, string>;
};

type BunSocket = {
  data: SocketData;
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  publish(topic: string, data: string): unknown;
};

/** The subset of `Bun.serve`'s server the host needs. */
export interface BunUpgradeServer {
  upgrade(request: Request, options: { data: SocketData }): boolean;
  publish(topic: string, data: string): unknown;
}

/** Handlers to pass as `websocket` to `Bun.serve`. */
export interface BunRuntimeWebSocketHandlers {
  open(socket: BunSocket): void;
  message(socket: BunSocket, message: string | Uint8Array): void;
  close(socket: BunSocket): void;
}

export interface BunRuntimeHost extends StatefulRuntime {
  readonly target: "bun";
  readonly websocket: BunRuntimeWebSocketHandlers;
  /** Must be called with the `Bun.serve` server before `connect` is used. */
  attachServer(server: BunUpgradeServer): void;
}

const key = (address: RuntimeAddress): string =>
  `${address.kind}/${address.id}`;

/*
 * Broadcasts go through Bun's pub/sub: one topic per instance, so a frame is
 * handed to Bun once and fanned out natively instead of once per socket. A
 * new topic per instance keeps a re-created address apart from the old one.
 */
type Instances = ReadonlyMap<
  string,
  { instance: RuntimeInstance; topic: string }
>;

function createWebSocketHandlers(
  instances: Instances,
): BunRuntimeWebSocketHandlers {
  return {
    open(socket) {
      const running = instances.get(socket.data.key);
      if (!running || running.instance.isClosed) {
        socket.close(1011, "unknown instance");
        return;
      }
      const { instance, topic } = running;
      const { id } = instance.attach(
        {
          send: (data) => void socket.send(data),
          close: (code, reason) => void socket.close(code, reason),
          join: () => socket.subscribe(topic),
          leave: () => socket.unsubscribe(topic),
          publishToOthers: (data) => void socket.publish(topic, data),
        },
        socket.data.params,
      );
      socket.data.connectionId = id;
    },
    message(socket, message) {
      const instance = instances.get(socket.data.key)?.instance;
      const id = socket.data.connectionId;
      if (!instance || !id) {
        return;
      }
      if (typeof message !== "string") {
        socket.close(1003, "text frames only");
        return;
      }
      void instance.message(id, message);
    },
    close(socket) {
      const id = socket.data.connectionId;
      if (id) {
        void instances.get(socket.data.key)?.instance.disconnect(id);
      }
    },
  };
}

/** Runtime Instances live in this process' memory. */
export function createBunRuntimeHost(
  definitions: readonly RuntimeDefinition[],
): BunRuntimeHost {
  const known = indexDefinitions(definitions);
  const instances = new Map<
    string,
    { instance: RuntimeInstance; topic: string }
  >();
  const pending = new Set<string>();
  let server: BunUpgradeServer | undefined;

  function find(address: RuntimeAddress): RuntimeInstance | undefined {
    assertValidAddress(address);
    const instance = instances.get(key(address))?.instance;
    return instance?.isClosed ? undefined : instance;
  }

  function require_(address: RuntimeAddress): RuntimeInstance {
    const instance = find(address);
    if (!instance) {
      throw new NotFoundError(`Unknown runtime instance ${key(address)}`);
    }
    return instance;
  }

  return {
    target: "bun",
    websocket: createWebSocketHandlers(instances),
    attachServer(next) {
      server = next;
    },

    async create(address, init = null) {
      assertValidAddress(address);
      const definition = known.get(address.kind);
      if (!definition) {
        throw new NotFoundError(`Unknown runtime kind "${address.kind}"`);
      }
      const id = key(address);
      if (find(address) || pending.has(id)) {
        throw new ConflictError(`Runtime instance ${id} already exists`);
      }
      pending.add(id);
      try {
        const topic = `${id}#${crypto.randomUUID()}`;
        const instance = await RuntimeInstance.start(
          definition,
          address,
          init,
          () => {
            if (instances.get(id)?.instance === instance) {
              instances.delete(id);
            }
          },
          (data) => void server?.publish(topic, data),
        );
        instances.set(id, { instance, topic });
      } finally {
        pending.delete(id);
      }
    },

    async exists(address) {
      return find(address) !== undefined;
    },

    async command(address, command): Promise<RuntimeJson> {
      return require_(address).command(command);
    },

    async close(address) {
      await find(address)?.close();
    },

    async connect(address, request, trusted) {
      require_(address);
      if (!server) {
        throw new Error("Bun Runtime Host: call attachServer(server) first");
      }
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }
      const params = connectionParams(request, trusted);
      const upgraded = server.upgrade(request, {
        data: { key: key(address), connectionId: undefined, params },
      });
      return upgraded
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 400 });
    },
  };
}
