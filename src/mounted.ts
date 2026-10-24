import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parseConfigResult, type z } from "./config.js";

/**
 * The runtime side of `instance = "mounted"`: a generic image reads what a
 * built-in instance has embedded (module configuration, artifacts) from the
 * directory mounted at `CHROMATIS_INSTANCE` when the server starts:
 *
 * - `config/<module>.toml`, validated with the module's schema;
 * - `artifacts/<artifact path>/`, checked with the artifact's validator;
 * - `site/`, static pages the proxy serves in front of the app (not read here).
 *
 * Anything invalid stops the server before it listens, with every finding.
 */
export const MOUNTED_CONFIG = "config";
export const MOUNTED_ARTIFACTS = "artifacts";
export const MOUNTED_SITE = "site";

export const mountedRoot = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): string => path.resolve(env.CHROMATIS_INSTANCE ?? "/instance");

export class MountedInstanceError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `The mounted instance cannot be used:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    this.name = "MountedInstanceError";
  }
}

/**
 * Runs a loader at startup; a mounted instance that cannot be used ends the
 * process with its findings instead of a stack trace.
 */
export function mountedOrExit<T>(load: () => T): T {
  const fail = (error: unknown): never => {
    if (error instanceof MountedInstanceError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  };
  try {
    const value = load();
    return (value instanceof Promise ? value.catch(fail) : value) as T;
  } catch (error) {
    return fail(error);
  }
}

export type MountedModule = Readonly<{
  name: string;
  /** The module's default-exported declaration (`defineModule`). */
  declaration: { readonly config?: { readonly schema: z.ZodType } };
  required: boolean;
}>;

export type MountedArtifact = Readonly<{
  id: string;
  path: string;
  validate?: (directory: string) => unknown;
}>;

/** `chromatis-config` of a mounted image. */
export function loadMountedConfig(
  name: string,
  modules: readonly MountedModule[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): {
  config: Readonly<Record<string, unknown>>;
  app: Readonly<{
    name: string;
    domain: string;
    publicUrl: string;
    environment: string;
  }>;
} {
  const environment = "production";
  const directory = path.join(mountedRoot(env), MOUNTED_CONFIG);
  const problems: string[] = [];
  const present = existsSync(directory)
    ? readdirSync(directory)
        .filter((file) => file.endsWith(".toml"))
        .sort()
    : [];
  for (const file of present) {
    const owner = file.slice(0, -".toml".length);
    if (owner === "app") {
      problems.push(
        `${MOUNTED_CONFIG}/app.toml belongs to the image; deployment settings come from the environment`,
      );
    } else if (!modules.some((module) => module.name === owner)) {
      problems.push(
        `${MOUNTED_CONFIG}/${file}: the image has no module "${owner}" with configuration`,
      );
    }
  }
  const config: Record<string, unknown> = {};
  for (const module of modules) {
    const schema = module.declaration.config?.schema;
    if (!schema) {
      continue;
    }
    const file = `${MOUNTED_CONFIG}/${module.name}.toml`;
    const source = path.join(directory, `${module.name}.toml`);
    const exists = existsSync(source);
    if (!exists && module.required) {
      problems.push(`${file} is missing`);
      continue;
    }
    const result = parseConfigResult(
      exists ? readFileSync(source, "utf8") : "",
      environment,
      schema,
    );
    if (result.ok) {
      config[module.name] = result.value;
    } else {
      problems.push(
        ...result.issues.map(
          (issue) => `${file}: ${issue.key}: ${issue.message}`,
        ),
      );
    }
  }
  let publicUrl: URL | undefined;
  try {
    publicUrl = new URL(env.PUBLIC_URL ?? "");
  } catch {
    problems.push(
      "PUBLIC_URL must be the public address, such as https://example.org",
    );
  }
  if (problems.length > 0 || !publicUrl) {
    throw new MountedInstanceError(problems);
  }
  return {
    config,
    app: {
      name,
      domain: publicUrl.hostname,
      publicUrl: publicUrl.origin,
      environment,
    },
  };
}

function base64Files(directory: string, prefix = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(directory).sort()) {
    const relative = path.posix.join(prefix, entry);
    const file = path.join(directory, entry);
    if (statSync(file).isDirectory()) {
      Object.assign(files, base64Files(file, relative));
    } else {
      files[relative] = readFileSync(file).toString("base64");
    }
  }
  return files;
}

/** `chromatis-artifacts` of a mounted image, in the shape a build embeds. */
export async function loadMountedArtifacts(
  declared: readonly MountedArtifact[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<
  Record<string, { basename: string; files: Record<string, string> }>
> {
  const root = path.join(mountedRoot(env), MOUNTED_ARTIFACTS);
  const problems: string[] = [];
  const artifacts: Record<
    string,
    { basename: string; files: Record<string, string> }
  > = {};
  for (const artifact of declared) {
    const directory = path.join(root, artifact.path);
    const label = `${MOUNTED_ARTIFACTS}/${artifact.path}`;
    if (!existsSync(directory) || !statSync(directory).isDirectory()) {
      problems.push(`${label} is missing (artifact ${artifact.id})`);
      continue;
    }
    if (artifact.validate) {
      const outcome = (await artifact.validate(directory)) as {
        ok?: unknown;
        errors?: unknown;
      } | null;
      if (outcome?.ok !== true) {
        const errors = Array.isArray(outcome?.errors)
          ? outcome.errors.map(String)
          : ["the validator rejected it"];
        problems.push(...errors.map((error) => `${label}: ${error}`));
        continue;
      }
    }
    artifacts[artifact.id] = {
      basename: path.basename(directory),
      files: base64Files(directory),
    };
  }
  if (problems.length > 0) {
    throw new MountedInstanceError(problems);
  }
  return artifacts;
}
