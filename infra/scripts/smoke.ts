import type { ApplicationDeclaration } from "../../src/declaration.js";
import { loadHook } from "./application.js";

export async function smokeTest(
  root: string,
  app: ApplicationDeclaration,
  target: "cloudflare" | "docker",
): Promise<void> {
  const smokeUrl =
    target === "docker" ? `http://localhost:${app.port}` : app.publicUrl;
  const response = await fetch(smokeUrl);
  if (response.status !== 200) {
    throw new Error(`Post-deploy GET / returned ${response.status}`);
  }
  const hook = await loadHook(root, app);
  if (hook?.realtimeRoute) {
    const probe = await fetch(new URL(hook.realtimeRoute, smokeUrl), {
      headers: { upgrade: "websocket" },
    });
    if (probe.status >= 500) {
      throw new Error(`Post-deploy realtime route returned ${probe.status}`);
    }
  }
  console.info("[deploy] smoke test passed");
}
