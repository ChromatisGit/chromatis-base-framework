import type { ResolvedApplication } from "./resolvedApplication.js";
import { loadHook } from "./application.js";

export async function smokeTest(
  app: ResolvedApplication,
  target: "cloudflare" | "docker",
  resolveWorkerDevUrl?: () => Promise<string>,
): Promise<void> {
  const smokeUrl =
    target === "docker" ? `http://localhost:${app.port}` : app.publicUrl;
  let activeUrl = smokeUrl;
  let response: Response | undefined;
  let publicFailure: string | undefined;
  try {
    response = await fetch(smokeUrl);
    if (response.status !== 200) {
      publicFailure = `HTTP ${response.status}`;
    }
  } catch (error) {
    publicFailure = error instanceof Error ? error.message : String(error);
  }

  if (publicFailure && target === "cloudflare" && resolveWorkerDevUrl) {
    let fallbackUrl: string;
    try {
      fallbackUrl = await resolveWorkerDevUrl();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Worker was deployed, but ${smokeUrl} failed (${publicFailure}) and the workers.dev URL could not be checked: ${detail}.`,
      );
    }
    try {
      response = await fetch(fallbackUrl);
    } catch (error) {
      const fallbackFailure =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `Worker was deployed, but both smoke checks failed: ${smokeUrl} (${publicFailure}) and ${fallbackUrl} (${fallbackFailure}).`,
      );
    }
    if (response.status !== 200) {
      throw new Error(
        `Worker was deployed, but both smoke checks failed: ${smokeUrl} (${publicFailure}) and ${fallbackUrl} (HTTP ${response.status}).`,
      );
    }
    activeUrl = fallbackUrl;
    console.warn(
      `[deploy] Worker is healthy at ${fallbackUrl}, but public URL ${smokeUrl} failed (${publicFailure}). Add ${smokeUrl} as a custom domain for this Worker in Cloudflare.`,
    );
  } else if (publicFailure) {
    throw new Error(
      `Post-deploy smoke test failed for ${smokeUrl}: ${publicFailure}`,
    );
  }

  const hook = await loadHook(app);
  if (hook?.realtimeRoute) {
    const probe = await fetch(new URL(hook.realtimeRoute, activeUrl), {
      headers: { upgrade: "websocket" },
    });
    if (probe.status >= 500) {
      throw new Error(`Post-deploy realtime route returned ${probe.status}`);
    }
  }
  console.info(`[deploy] smoke test passed at ${activeUrl}`);
}
