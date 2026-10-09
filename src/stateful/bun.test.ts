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
