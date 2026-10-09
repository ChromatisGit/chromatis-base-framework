# Stateful Runtime

Addressable, temporary, coordinated Runtime Instances. Chromatis never
interprets instance state or realtime messages; applications define both.

```ts
import type { RuntimeDefinition } from "@chromatis/base/stateful";

const room: RuntimeDefinition = {
  kind: "room",
  create(context, init) {
    return {
      onCommand: (command) => ({ connections: context.connections().length }),
      onConnect: (c) => context.broadcast(`joined:${c.id}`),
      onMessage: (c, data) => context.broadcast(data, { except: c }),
    };
  },
};
```

## Contract

- `StatefulRuntime`: `create`, `exists`, `command`, `close`, `connect`, addressed by `{ kind, id }`.
- State lives in memory for the instance's lifetime only. It is not persistence.
- Everything touching one instance (commands, connects, messages, disconnects, close) runs serially in arrival order.
- Commands and results are JSON; both hosts enforce this.
- `onConnect` throwing closes that connection with 1008; `onMessage` throwing closes it with 1011; the instance continues.
- Closing closes all connections (1000), runs `onClose` once, frees the address, and is idempotent. An instance can close itself with `context.close()`.
- `connect(address, request, trusted?)`: `trusted` parameters are set by the server and override same-named query parameters, so credentials can reach `onConnect` without appearing in the client's URL.
- Errors (`NotFoundError`, `ConflictError`, `ValidationError`, ...) keep their type across hosts.

## Hosts

Both hosts delegate to the shared `RuntimeInstance`, so lifecycle semantics cannot diverge.

**Bun** (`@chromatis/base/stateful/bun`): process-local instances.

```ts
const host = createBunRuntimeHost([room]);
const server = Bun.serve({
  fetch: (req) => host.connect({ kind: "room", id }, req),
  websocket: host.websocket,
});
host.attachServer(server);
```

**Cloudflare** (`@chromatis/base/stateful/cloudflare`): one Durable Object per instance.

```ts
export const RuntimeInstanceObject = createRuntimeDurableObject([room]);
// in the Worker:
const host = createCloudflareRuntimeHost(env.RUNTIME_OBJECTS, [room]);
```

The Durable Object holds memory-only state and accepts WebSockets without hibernation so it stays resident while connections are open. Cloudflare APIs are not imported; only structural types are used.

## Tests

`src/stateful/contract.suite.ts` is one suite run against every host:

- `bun.test.ts`: real `Bun.serve` and WebSocket.
- `cloudflare.test.ts`: the Durable Object class and Worker host wired through an in-process namespace and fake `WebSocketPair`. `@chromatis/base/stateful/testing` exports this harness (`createInProcessCloudflareHost`) so applications can run their own runtime definitions against the Cloudflare host in tests.
- `workerd.test.ts`: the same Cloudflare code bundled and run inside workerd via Miniflare, with real Durable Objects and WebSockets.

Not covered: Durable Object eviction while idle (memory state is lost, as the contract states).
