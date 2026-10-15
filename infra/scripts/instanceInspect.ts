import type { ConfigEnvironment } from "../../src/config.js";
import { inspectSecrets, type SecretDefinition } from "../../src/secrets.js";
import { z } from "../../src/config.js";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  flattenExtra,
  flattenRoutes,
  INSTANCE_ROOT_FILE,
  loadExtraRoutes,
} from "./routes.js";
import type { ResolvedShell } from "./resolvedApplication.js";
import { publicUrl } from "./appConfig.js";
import { instanceMode, loadInstance, type InstanceMode } from "./instance.js";
import {
  artifactRequirements,
  contributionDeclarations,
  declaredSecrets,
  partitionSecrets,
  type ArtifactRequirement,
  type ContributionDeclaration,
  type DeclaredSecret,
} from "./moduleSet.js";
import { formatProblem, type Problem } from "./problems.js";
import { findSecretLeaks, looksLikeSecretKey } from "./secretHygiene.js";
import {
  applicationService,
  defaultSecretLookup,
  type SecretLookup,
} from "./secretStore.js";

export type ModuleReport = Readonly<{
  name: string;
  entry: string;
  config:
    | Readonly<{
        file: string;
        required: boolean;
        present: boolean;
        effective: unknown;
      }>
    | undefined;
  runtime: readonly string[];
  serverHook: string | undefined;
  database: boolean;
  secrets: readonly string[];
  contributions: readonly string[];
  artifacts: readonly string[];
}>;

export type DisabledModuleReport = Readonly<{
  name: string;
  entry: string;
  /** Why it is not in effect. */
  reason: string;
  /** What it would have contributed. */
  runtime: readonly string[];
  database: boolean;
  secrets: readonly string[];
  contributions: readonly string[];
  artifacts: readonly string[];
}>;

export type RouteReport = Readonly<{
  id: string;
  owner: string;
  kind: "route" | "index" | "layout";
  /** URL path; undefined for layouts. */
  url: string | undefined;
  file: string;
}>;

export type ShellReport = Readonly<{
  /** Where the React Router root comes from. */
  root: Readonly<{
    source: "instance" | "product" | "none";
    file: string | undefined;
  }>;
  /** Product routes, depth first. */
  routes: readonly RouteReport[];
  /** Product paths the instance replaced. */
  omitted: readonly string[];
  /** Routes of the instance's own app/routes.ts, appended after the product's. */
  extraRoutes: readonly RouteReport[];
}>;

export type SecretReport = DeclaredSecret &
  Readonly<{ requiredNow: boolean; configured: boolean }>;

export type InspectReport = Readonly<{
  root: string;
  mode: InstanceMode;
  environment: ConfigEnvironment;
  package: Readonly<{ name: string; version: string | undefined }> | undefined;
  application:
    | Readonly<{
        name: string;
        target: string;
        domain: string | undefined;
        publicUrl: string | undefined;
        port: number | undefined;
      }>
    | undefined;
  modules: readonly ModuleReport[];
  /** Discovered but switched off: they contribute nothing. */
  disabledModules: readonly DisabledModuleReport[];
  shell: ShellReport | undefined;
  contributions: readonly ContributionDeclaration[];
  artifacts: readonly ArtifactRequirement[];
  secrets: readonly SecretReport[];
  problems: readonly Problem[];
  /** Everything that must be resolved before building or deploying. */
  unmet: readonly string[];
}>;

const REDACTED = "[redacted]";

/** Masks credential-looking keys and URL passwords; secrets never print. */
export function redact(value: unknown, declared: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, declared));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        looksLikeSecretKey(key) || declared.has(key)
          ? REDACTED
          : redact(child, declared),
      ]),
    );
  }
  if (
    typeof value === "string" &&
    findSecretLeaks({ value }, []).some((leak) => leak.key === "value")
  ) {
    return REDACTED;
  }
  return value;
}

async function shellReport(
  root: string,
  shell: ResolvedShell,
): Promise<ShellReport> {
  const own = path.join(root, INSTANCE_ROOT_FILE);
  const extra = await loadExtraRoutes(root);
  return {
    root: existsSync(own)
      ? { source: "instance", file: own }
      : shell.root
        ? { source: "product", file: shell.root.from }
        : { source: "none", file: undefined },
    routes: flattenRoutes(shell.routes),
    omitted: shell.omitted,
    extraRoutes: flattenExtra(extra.routes ?? []),
  };
}

async function secretReports(
  secrets: readonly DeclaredSecret[],
  appName: string | undefined,
  environment: ConfigEnvironment,
  lookup: SecretLookup,
): Promise<SecretReport[]> {
  const { required } = partitionSecrets(secrets, environment);
  const values = new Map<string, string>();
  if (appName) {
    for (const secret of secrets) {
      const value = await lookup(
        applicationService(appName, environment),
        secret.name,
      );
      if (value) {
        values.set(secret.name, value);
      }
    }
  }
  const definitions: SecretDefinition[] = secrets.map((secret) => ({
    name: secret.name,
    owner: secret.owner,
    description: secret.description,
    required: required.includes(secret.name),
    schema: z.string().min(1),
  }));
  const status = inspectSecrets(definitions, {
    get: (name) => values.get(name),
  });
  return secrets.map((secret, index) => ({
    ...secret,
    requiredNow: required.includes(secret.name),
    configured: status[index]?.configured ?? false,
  }));
}

function unmetSecrets(secrets: readonly SecretReport[]): string[] {
  return secrets
    .filter((secret) => secret.requiredNow && !secret.configured)
    .map(
      (secret) =>
        `secret ${secret.name} (${secret.owner}) is not set; run chromatis secret`,
    );
}

/** Builds the diagnostics report; never throws for an invalid instance. */
export async function inspectInstance(
  root: string,
  environment: ConfigEnvironment,
  lookup: SecretLookup = defaultSecretLookup,
): Promise<InspectReport> {
  const mode = instanceMode(root);
  const instance = await loadInstance(root, environment);
  const modules = instance.modules.map(({ module }) => module);
  const secrets = await secretReports(
    declaredSecrets(modules),
    instance.name,
    environment,
    lookup,
  );
  const names = new Set(secrets.map((secret) => secret.name));
  const deployment = instance.appConfig?.deployment;
  return {
    root,
    mode,
    environment,
    package: instance.discovery
      ? {
          name: instance.discovery.packageName,
          version: instance.discovery.packageVersion,
        }
      : undefined,
    application: deployment
      ? {
          name: instance.name ?? "?",
          target: deployment.target,
          domain: deployment.domain,
          publicUrl: publicUrl(deployment),
          port: deployment.port,
        }
      : undefined,
    modules: instance.modules.map(({ module, config }) => ({
      name: module.name,
      entry: module.entry,
      config: config
        ? {
            file: config.file,
            required: config.slot.required,
            present: config.present,
            effective: redact(config.effective, names),
          }
        : undefined,
      runtime: module.declaration.runtime,
      serverHook: module.declaration.serverHook,
      database: module.declaration.database,
      secrets: module.declaration.secrets.map((secret) => secret.name),
      contributions: module.declaration.contributions.map((c) => c.id),
      artifacts: module.declaration.artifacts.map((a) => a.id),
    })),
    disabledModules: instance.disabled.map((module) => ({
      name: module.name,
      entry: module.entry,
      reason: "disabled in config/app.toml ([modules] disabled)",
      runtime: module.declaration.runtime,
      database: module.declaration.database,
      secrets: module.declaration.secrets.map((secret) => secret.name),
      contributions: module.declaration.contributions.map((c) => c.id),
      artifacts: module.declaration.artifacts.map((a) => a.id),
    })),
    shell: await shellReport(root, instance.shell),
    contributions: contributionDeclarations(modules),
    artifacts: artifactRequirements(modules, root),
    secrets,
    problems: instance.problems,
    unmet: [...instance.problems.map(formatProblem), ...unmetSecrets(secrets)],
  };
}
