import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type ConfigEnvironment } from "../../src/config.js";
import { INSTANCE_ROOT_FILE, resolveShell } from "./routes.js";
import { buildPlan } from "./buildPlan.js";
import { appConfigSchema, publicUrl, type AppConfig } from "./appConfig.js";
import {
  configFile,
  evaluateSlot,
  findOrphanConfigs,
  type ConfigSlot,
  type SlotResult,
} from "./instanceConfig.js";
import {
  discoverManifest,
  loadModules,
  type LoadedModule,
  type ManifestDiscovery,
} from "./manifestDiscovery.js";
import {
  declaredSecrets,
  partitionSecrets,
  validateModuleSet,
} from "./moduleSet.js";
import { InstanceProblemsError, type Problem } from "./problems.js";
import {
  targetFromConfig,
  type ResolvedApplication,
  type ResolvedShell,
} from "./resolvedApplication.js";

export type InstanceModule = Readonly<{
  module: LoadedModule;
  /** Undefined when the module declares no config. */
  config: SlotResult | undefined;
}>;

export type Instance = Readonly<{
  root: string;
  environment: ConfigEnvironment;
  discovery: ManifestDiscovery | undefined;
  modules: readonly InstanceModule[];
  /** Discovered modules switched off in `config/app.toml` (`[modules] disabled`). */
  disabled: readonly LoadedModule[];
  /** Root and routes of the product package and its active modules. */
  shell: ResolvedShell;
  app: SlotResult;
  appConfig: AppConfig | undefined;
  /** Worker/service identity, once `config/app.toml` is valid. */
  name: string | undefined;
  /** Every finding, in a stable order. */
  problems: readonly Problem[];
}>;

export const APP_CONFIG_FILE = configFile("app");

export type InstanceMode = "instance" | "none";

export function instanceMode(root: string): InstanceMode {
  return existsSync(path.join(root, APP_CONFIG_FILE)) ? "instance" : "none";
}

function instanceName(root: string, configured: string | undefined) {
  if (configured) {
    return { name: configured };
  }
  const raw = (
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      name?: unknown;
    }
  ).name;
  const name = typeof raw === "string" ? raw.replace(/^@[^/]+\//, "") : "";
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return {
      problem: {
        source: "package.json",
        key: "name",
        message: `"${String(raw)}" cannot name the deployment; set [deployment] name in ${APP_CONFIG_FILE}`,
      } satisfies Problem,
    };
  }
  return { name };
}

const EMPTY_SHELL: ResolvedShell = { root: undefined, routes: [], omitted: [] };

/** A product with routes needs a root, from the package or the instance. */
function rootProblems(shell: ResolvedShell, root: string): Problem[] {
  return shell.routes.length > 0 &&
    !shell.root &&
    !existsSync(path.join(root, INSTANCE_ROOT_FILE))
    ? [
        {
          source: "root",
          message: `the product declares routes but no root; add ${INSTANCE_ROOT_FILE} or declare app.root in the manifest`,
        },
      ]
    : [];
}

function unknownDisabled(
  requested: readonly string[],
  known: readonly string[],
  discovery: ManifestDiscovery | undefined,
): Problem[] {
  return discovery
    ? requested
        .filter((name) => !known.includes(name))
        .map((name) => ({
          source: APP_CONFIG_FILE,
          key: "modules.disabled",
          message: `unknown module "${name}" (${discovery.packageName} provides: ${known.join(", ") || "none"})`,
        }))
    : [];
}

async function discover(root: string): Promise<{
  discovery: ManifestDiscovery | undefined;
  discovered: LoadedModule[];
  problems: Problem[];
}> {
  const problems: Problem[] = [];
  let discovery: ManifestDiscovery | undefined;
  let discovered: LoadedModule[] = [];
  try {
    discovery = discoverManifest(root);
  } catch (error) {
    if (!(error instanceof InstanceProblemsError)) {
      throw error;
    }
    problems.push(...error.problems);
  }
  if (discovery) {
    const result = await loadModules(discovery, root);
    discovered = result.modules;
    problems.push(...result.problems);
  }
  return { discovery, discovered, problems };
}

/**
 * Discovers modules and validates all configuration. Never throws for an
 * invalid instance; every finding is in `problems`. Config is validated in
 * every environment; `environment` selects the effective values.
 */
export async function loadInstance(
  root: string,
  environment: ConfigEnvironment,
): Promise<Instance> {
  const { discovery, discovered, problems } = await discover(root);

  const secretNames = declaredSecrets(discovered).map((secret) => secret.name);
  const slot = (
    owner: string,
    schema: ConfigSlot["schema"],
    required: boolean,
  ) =>
    evaluateSlot(root, { owner, schema, required }, environment, secretNames);
  const app = slot("app", appConfigSchema, true);
  const appConfig =
    app.present && app.problems.length === 0
      ? (app.effective as AppConfig | undefined)
      : undefined;

  const requested = appConfig?.modules.disabled ?? [];
  const known = discovery?.manifest.modules.map((listed) => listed.name) ?? [];
  const disabled = discovered.filter((module) =>
    requested.includes(module.name),
  );
  const loaded = discovered.filter(
    (module) => !requested.includes(module.name),
  );
  problems.push(
    ...unknownDisabled(requested, known, discovery),
    ...validateModuleSet(loaded, root),
  );
  const { shell, problems: shellProblems } = discovery
    ? resolveShell({
        discovery,
        modules: loaded,
        omit: appConfig?.routes.omit ?? [],
        root,
      })
    : { shell: EMPTY_SHELL, problems: [] };
  problems.push(...shellProblems, ...rootProblems(shell, root));
  const modules: InstanceModule[] = loaded.map((module) => ({
    module,
    config: module.declaration.config
      ? slot(
          module.name,
          module.declaration.config.schema,
          module.declaration.config.required,
        )
      : undefined,
  }));
  problems.push(
    ...app.problems,
    ...modules.flatMap((m) => m.config?.problems ?? []),
  );
  if (discovery) {
    problems.push(
      ...findOrphanConfigs(
        root,
        [
          "app",
          ...discovery.manifest.modules
            .filter(
              (listed) => listed.config && !requested.includes(listed.name),
            )
            .map((listed) => listed.name),
        ],
        known,
        discovery.packageName,
        requested,
      ),
    );
  }

  const named = appConfig
    ? instanceName(root, appConfig.deployment.name)
    : undefined;
  if (named?.problem) {
    problems.push(named.problem);
  }
  const name = named?.name;
  return {
    root,
    environment,
    discovery,
    modules,
    disabled,
    shell,
    app,
    appConfig,
    name,
    problems,
  };
}

export function applicationFrom(instance: Instance): ResolvedApplication {
  const { appConfig, name, discovery } = instance;
  if (!appConfig || !name || !discovery) {
    throw new InstanceProblemsError(instance.problems);
  }
  const modules = instance.modules.map(({ module }) => module);
  const secrets = declaredSecrets(modules);
  const { required, optional } = partitionSecrets(
    secrets,
    instance.environment,
  );
  const { deployment } = appConfig;
  return {
    name,
    instanceRoot: instance.root,
    publicUrl: publicUrl(deployment),
    target: targetFromConfig(deployment.target),
    port: deployment.port,
    environment: instance.environment,
    packageRoot: discovery.packageRoot,
    postgresql: modules.some((module) => module.declaration.database),
    runtime: modules.flatMap((module) => module.declaration.runtime).sort(),
    serverHook: modules.find((module) => module.serverHook)?.serverHook,
    secrets: required,
    optionalSecrets: optional,
    declaredSecrets: secrets,
    shell: instance.shell,
    ...buildPlan(instance),
    bundledPackages: [discovery.packageName],
    allowedRoots: [discovery.packageRoot],
  };
}

/**
 * The application the build, dev and deploy commands act on. Throws
 * `InstanceProblemsError` listing every problem when the instance is invalid.
 */
export async function resolveApplication(
  root: string,
  environment: ConfigEnvironment,
): Promise<ResolvedApplication> {
  const instance = await loadInstance(root, environment);
  if (instance.problems.length > 0) {
    throw new InstanceProblemsError(instance.problems);
  }
  return applicationFrom(instance);
}
