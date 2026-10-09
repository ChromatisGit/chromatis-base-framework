import {
  createCloudflareRuntimeHost,
  createRuntimeDurableObject,
  type RuntimeDurableObjectPlatform,
} from "./cloudflare.js";
import type {
  RuntimeAddress,
  RuntimeDefinition,
  StatefulRuntime,
} from "./contract.js";

/*
 * In-process Cloudflare Runtime Host for application tests: the real
 * Durable Object class and Worker-side host, wired through an in-memory
 * namespace and fake WebSocket pair. No workerd needed.
 */

type Listener = (event: { data?: unknown; code?: number }) => void;

/** In-memory stand-in for a Workers WebSocket; delivery is asynchronous. */
export class FakeSocket {
  peer!: FakeSocket;
  closed = false;
  private listeners = new Map<string, Listener[]>();
  private backlog: [string, { data?: unknown; code?: number }][] = [];

  accept(): void {}

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    const queued = this.backlog.filter(([kind]) => kind === type);
    this.backlog = this.backlog.filter(([kind]) => kind !== type);
    for (const [, event] of queued) {
      listener(event);
    }
  }

  send(data: string): void {
    if (this.closed) {
      return;
    }
    const peer = this.peer;
    queueMicrotask(() => peer.emit("message", { data }));
  }

  close(code = 1005): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.peer.closed = true;
    const peer = this.peer;
    queueMicrotask(() => {
      peer.emit("close", { code });
      this.emit("close", { code });
    });
  }

  emit(type: string, event: { data?: unknown; code?: number }): void {
    if (!this.listeners.has(type)) {
      this.backlog.push([type, event]);
      return;
    }
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakePair {
  0 = new FakeSocket();
  1 = new FakeSocket();
  constructor() {
    this[0].peer = this[1];
    this[1].peer = this[0];
  }
}

const platform: RuntimeDurableObjectPlatform = {
  WebSocketPair: FakePair as never,
  upgradeResponse(client) {
    const response = new Response(null);
    Object.defineProperty(response, "status", { value: 101 });
    Object.defineProperty(response, "ok", { value: false });
    Object.defineProperty(response, "webSocket", { value: client });
    return response;
  },
};

export interface InProcessCloudflareHost {
  readonly host: StatefulRuntime;
  /** Opens a realtime connection the way a Worker would hand one out. */
  open(
    address: RuntimeAddress,
    params?: Record<string, string>,
  ): Promise<FakeSocket>;
}

export function createInProcessCloudflareHost(
  definitions: readonly RuntimeDefinition[],
): InProcessCloudflareHost {
  const DurableObject = createRuntimeDurableObject(definitions, platform);
  const objects = new Map<string, InstanceType<typeof DurableObject>>();
  const namespace = {
    idFromName: (name: string) => name,
    get(id: unknown) {
      const name = String(id);
      let object = objects.get(name);
      if (!object) {
        object = new DurableObject({}, {});
        objects.set(name, object);
      }
      const target = object;
      return { fetch: (request: Request) => target.fetch(request) };
    },
  };
  const host = createCloudflareRuntimeHost(namespace, definitions);
  return {
    host,
    async open(address, params = {}) {
      const query = new URLSearchParams(params).toString();
      const response = await host.connect(
        address,
        new Request(`http://worker/connect?${query}`, {
          headers: { upgrade: "websocket" },
        }),
      );
      const socket = (response as unknown as { webSocket: FakeSocket })
        .webSocket;
      socket.accept();
      return socket;
    },
  };
}
