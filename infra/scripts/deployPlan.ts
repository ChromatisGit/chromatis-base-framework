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
        secrets: [...app.secrets, ...app.optionalSecrets],
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
