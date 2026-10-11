import { writeFileSync } from "node:fs";
import path from "node:path";
import { frameworkRoot } from "./application.js";
import type { ResolvedApplication } from "./resolvedApplication.js";

export function writeDockerArtifacts(
  root: string,
  app: ResolvedApplication,
  values: Record<string, string>,
  output: string,
): string {
  const envPath = path.join(output, "app.env");
  writeFileSync(
    envPath,
    `${Object.entries({
      PORT: String(app.port),
      PUBLIC_URL: app.publicUrl,
      ...values,
    })
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );
  const compose = {
    services: {
      app: {
        build: {
          context: path.join(root, ".chromatis/image"),
          dockerfile: path.join(frameworkRoot, "infra/deploy/Dockerfile"),
          args: { APP_PORT: String(app.port) },
        },
        image: `${app.name}:chromatis`,
        env_file: [envPath],
        ports: [`${app.port}:${app.port}`],
        healthcheck: {
          test: [
            "CMD",
            "bun",
            "-e",
            `fetch('http://localhost:${app.port}/_chromatis/health').then(r=>process.exit(r.ok?0:1))`,
          ],
          interval: "30s",
          timeout: "5s",
          retries: 3,
        },
      },
    },
  };
  const composePath = path.join(output, "compose.json");
  writeFileSync(composePath, `${JSON.stringify(compose, null, 2)}\n`);
  return composePath;
}
