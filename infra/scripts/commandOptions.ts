import {
  configEnvironmentSchema,
  type ConfigEnvironment,
} from "../../src/config.js";
import type { BuildTarget } from "./resolvedApplication.js";

/** Value of `--name value` or `--name=value`. */
export function optionValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const flag = `--${name}`;
  const index = args.findIndex(
    (arg) => arg === flag || arg.startsWith(`${flag}=`),
  );
  if (index < 0) {
    return undefined;
  }
  const arg = args[index] ?? "";
  const value = arg.includes("=")
    ? arg.slice(flag.length + 1)
    : args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

const LOCAL_COMMANDS = ["dev", "init", "secret", "check", "fix", "inspect"];

/** `--env` wins; development commands use local, build and deploy production. */
export function commandEnvironment(
  command: string,
  args: readonly string[],
): ConfigEnvironment {
  const chosen = optionValue(args, "env");
  if (chosen !== undefined) {
    const parsed = configEnvironmentSchema.safeParse(chosen);
    if (!parsed.success) {
      throw new Error("--env must be local, test or production");
    }
    return parsed.data;
  }
  return LOCAL_COMMANDS.includes(command) ? "local" : "production";
}

/** `--target cloudflare|bun|docker`; `bun` and `docker` are the Bun server. */
export function targetOption(
  args: readonly string[],
  fallback: BuildTarget,
): BuildTarget {
  const chosen = optionValue(args, "target") ?? fallback;
  if (chosen === "cloudflare") {
    return "cloudflare";
  }
  if (chosen === "docker" || chosen === "bun") {
    return "docker";
  }
  throw new Error("--target must be cloudflare or bun (docker)");
}
