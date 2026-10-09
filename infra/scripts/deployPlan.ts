import type { ApplicationDeclaration } from "../../src/declaration.js";

export function printPlan(
  app: ApplicationDeclaration,
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
        variables: ["PUBLIC_URL", ...Object.keys(app.variables)],
        secrets: [...app.secrets, ...app.optionalSecrets],
        contentMounts: Object.keys(app.contentMounts),
        artifacts: artifacts.output,
        dryRun,
      },
      null,
      2,
    ),
  );
}
