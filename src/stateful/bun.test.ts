import { expect, test } from "bun:test";
import { createBunRuntimeHost } from "./bun.js";
import { observed, roomDefinition } from "./contract.fixture.js";
import { runRuntimeContractTests } from "./contract.suite.js";

runRuntimeContractTests("Bun Runtime Host", async () => {
  observed.closes.length = 0;
  const host = createBunRuntimeHost([roomDefinition]);
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const [, , kind = "", id = ""] = new URL(request.url).pathname.split("/");
      return host.connect({ kind, id }, request);
    },
    websocket: host.websocket as never,
  });
  host.attachServer(server as never);

  return {
    runtime: host,
    async open(address, params = {}) {
      const query = new URLSearchParams(params).toString();
      return new WebSocket(
        `ws://localhost:${server.port}/connect/${address.kind}/${address.id}?${query}`,
      );
    },
    async closes() {
      return [...observed.closes];
    },
    async dispose() {
      await server.stop(true);
    },
  };
});

test("Bun Runtime Host broadcasts through one publish per frame", async () => {
  const host = createBunRuntimeHost([roomDefinition]);
  const published: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (request) => host.connect({ kind: "room", id: "p" }, request),
    websocket: host.websocket as never,
  });
  host.attachServer({
    upgrade: (request, options) => server.upgrade(request, options as never),
    publish: (topic, data) => {
      published.push(data);
      return server.publish(topic, data);
    },
  });
  try {
    await host.create({ kind: "room", id: "p" });
    const received: string[] = [];
    const sockets: WebSocket[] = [];
    for (const name of ["ann", "bob", "cid"]) {
      const socket = new WebSocket(
        `ws://localhost:${server.port}/?name=${name}`,
      );
      socket.addEventListener("message", (event) =>
        received.push(String(event.data)),
      );
      sockets.push(socket);
      while (!received.includes(`joined:${name}`)) {
        await Bun.sleep(5);
      }
    }
    sockets[0]?.send("hi");
    while (received.filter((data) => data === "ann:hi").length < 3) {
      await Bun.sleep(5);
    }
    expect(published).toEqual([
      "joined:ann",
      "joined:bob",
      "joined:cid",
      "ann:hi",
    ]);
    for (const socket of sockets) {
      socket.close();
    }
  } finally {
    await server.stop(true);
  }
});
