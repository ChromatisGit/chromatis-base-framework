import { resolveEnvironment } from "./config.js";
import type { ConfigEnvironment } from "./config.js";
import type { SecretSource } from "./secrets.js";

export type RuntimeTarget = "bun" | "cloudflare";

export type Runtime = Readonly<{
  target: RuntimeTarget;
  environment: ConfigEnvironment;
  secrets: SecretSource;
}>;

function fromRecord(values: Readonly<Record<string, unknown>>): SecretSource {
  return {
    get(name) {
      const value = values[name];
      return typeof value === "string" && value.length > 0 ? value : undefined;
    },
  };
}

export function createBunRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): Runtime {
  return {
    target: "bun",
    environment: resolveEnvironment(environment.NODE_ENV),
    secrets: fromRecord(environment),
  };
}

export function createCloudflareRuntime(
  bindings: Readonly<Record<string, unknown>>,
  environment: string,
): Runtime {
  return {
    target: "cloudflare",
    environment: resolveEnvironment(environment),
    secrets: fromRecord(bindings),
  };
}
