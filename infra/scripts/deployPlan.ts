import { deploymentSecrets } from "./imageDeployment.js";
import type { ResolvedApplication } from "./resolvedApplication.js";

export function printPlan(
  app: ResolvedApplication,
  target: "cloudflare" | "docker",
  dryRun: boolean,
  artifacts: { output: string; migrations: readonly { tag: string }[] },
): void {
  console.info(
    JSON.stringify(
      {
        target,
        name: app.name,
        publicUrl: app.publicUrl,
        postgresql: app.postgresql,
        bindings: app.runtime.map(
          (kind) => `RUNTIME_${kind.toUpperCase().replaceAll("-", "_")}`,
        ),
        migrations: artifacts.migrations.map(({ tag }) => tag),
        variables: ["PUBLIC_URL"],
        secrets: [...deploymentSecrets(app), ...app.optionalSecrets],
        ...(app.image
          ? {
              image: `${app.image.name}:${app.image.tag}`,
              server: app.server.ssh
                ? `${app.server.ssh}:${app.server.path}`
                : "this machine",
            }
          : {}),
        contributions: app.contributions.map(({ id }) => id),
        artifacts: app.artifacts.map(({ id }) => id),
        generated: artifacts.output,
        dryRun,
      },
      null,
      2,
    ),
  );
}
