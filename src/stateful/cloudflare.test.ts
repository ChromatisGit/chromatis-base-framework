import { createInProcessCloudflareHost } from "./testing.js";
import { observed, roomDefinition } from "./contract.fixture.js";
import { runRuntimeContractTests } from "./contract.suite.js";

runRuntimeContractTests(
  "Cloudflare Runtime Host (Durable Object harness)",
  async () => {
    observed.closes.length = 0;
    const { host, open } = createInProcessCloudflareHost([roomDefinition]);
    return {
      runtime: host,
      open,
      async closes() {
        return [...observed.closes];
      },
      async dispose() {},
    };
  },
);
