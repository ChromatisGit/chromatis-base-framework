import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "smol-toml";
import {
  CONFIG_ENVIRONMENTS,
  parseConfigResult,
  type ConfigEnvironment,
  type ConfigIssue,
  type z,
} from "../../src/config.js";
import type { Problem } from "./problems.js";
import { assertPlainData } from "./virtualModules.js";
import { findSecretLeaks } from "./secretHygiene.js";

export const CONFIG_DIRECTORY = "config";

export const configFile = (owner: string): string =>
  `${CONFIG_DIRECTORY}/${owner}.toml`;

/** A config file an instance may provide, with the schema that owns it. */
export type ConfigSlot = Readonly<{
  /** `app` or a module name. */
  owner: string;
  schema: z.ZodType;
  /** The file must exist even if every value has a default. */
  required: boolean;
}>;

export type SlotResult = Readonly<{
  slot: ConfigSlot;
  file: string;
  present: boolean;
  problems: readonly Problem[];
  /** Validated configuration of the selected environment. */
  effective: Readonly<unknown> | undefined;
  /** Missing, and the schema's defaults alone are a valid configuration. */
  creatableFromDefaults: boolean;
}>;

function sourceFor(root: string, owner: string): string | undefined {
  const file = path.join(root, configFile(owner));
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

/**
 * Validates one slot in every environment so a production-only mistake is
 * caught on a developer machine. Identical findings are reported once.
 */
function validateAllEnvironments(
  slot: ConfigSlot,
  text: string,
  environment: ConfigEnvironment,
  file: string,
): { problems: Problem[]; effective: Readonly<unknown> | undefined } {
  const grouped = new Map<
    string,
    { key: string; message: string; environments: string[] }
  >();
  let effective: Readonly<unknown> | undefined;
  for (const candidate of CONFIG_ENVIRONMENTS) {
    const result = parseConfigResult(text, candidate, slot.schema);
    const issues = result.ok ? plainDataIssues(result.value) : result.issues;
    if (result.ok && issues.length === 0) {
      if (candidate === environment) {
        effective = result.value;
      }
      continue;
    }
    for (const issue of issues) {
      const id = `${issue.key}\0${issue.message}`;
      const entry = grouped.get(id) ?? { ...issue, environments: [] };
      entry.environments.push(candidate);
      grouped.set(id, entry);
    }
  }
  return {
    problems: [...grouped.values()].map((entry) => ({
      source: file,
      key: entry.key,
      message:
        entry.environments.length === CONFIG_ENVIRONMENTS.length
          ? entry.message
          : `${entry.message} (${entry.environments.join(", ")})`,
    })),
    effective,
  };
}

/** Runtime code receives configuration as generated JSON, so it must be plain data. */
function plainDataIssues(value: unknown): ConfigIssue[] {
  try {
    assertPlainData(value, "config");
    return [];
  } catch (error) {
    return [
      {
        key: "configuration",
        message: `${error instanceof Error ? error.message : String(error)}; use strings, numbers, booleans, arrays and tables`,
      },
    ];
  }
}

function defaultsAreValid(slot: ConfigSlot): boolean {
  return CONFIG_ENVIRONMENTS.every(
    (environment) => parseConfigResult("", environment, slot.schema).ok,
  );
}

export function evaluateSlot(
  root: string,
  slot: ConfigSlot,
  environment: ConfigEnvironment,
  declaredSecrets: Iterable<string>,
): SlotResult {
  const file = configFile(slot.owner);
  const text = sourceFor(root, slot.owner);
  if (text === undefined) {
    const usable = defaultsAreValid(slot);
    const undecided = parseConfigResult("", environment, slot.schema);
    const decisions = undecided.ok
      ? ""
      : ` (${[...new Set(undecided.issues.map((issue) => issue.key))].join(", ")})`;
    const problems: Problem[] = [];
    if (slot.required) {
      problems.push({
        source: file,
        message: usable
          ? "file is missing; run chromatis fix to create it from the defaults"
          : `file is missing and has required values to decide${decisions}`,
      });
    } else if (!usable) {
      problems.push({
        source: file,
        message: `file is missing but the schema has required values${decisions}`,
      });
    }
    const defaults = parseConfigResult("", environment, slot.schema);
    if (defaults.ok) {
      problems.push(
        ...plainDataIssues(defaults.value).map((issue) => ({
          source: file,
          key: issue.key,
          message: issue.message,
        })),
      );
    }
    return {
      slot,
      file,
      present: false,
      problems,
      effective: defaults.ok ? defaults.value : undefined,
      creatableFromDefaults: usable,
    };
  }
  const { problems, effective } = validateAllEnvironments(
    slot,
    text,
    environment,
    file,
  );
  try {
    for (const leak of findSecretLeaks(parse(text), declaredSecrets)) {
      problems.push({ source: file, ...leak });
    }
  } catch {
    // Syntax errors are already reported by validation.
  }
  return {
    slot,
    file,
    present: true,
    problems,
    effective,
    creatableFromDefaults: false,
  };
}

/** `config/*.toml` files that no module (or Chromatis itself) owns. */
export function findOrphanConfigs(
  root: string,
  owners: readonly string[],
  moduleNames: readonly string[],
  packageName: string,
  disabled: readonly string[] = [],
): Problem[] {
  const directory = path.join(root, CONFIG_DIRECTORY);
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith(".toml"))
    .sort()
    .map((name) => name.slice(0, -".toml".length))
    .filter((owner) => !owners.includes(owner))
    .map((owner) => ({
      source: configFile(owner),
      message: disabled.includes(owner)
        ? `module "${owner}" is disabled in config/app.toml; remove the file`
        : moduleNames.includes(owner)
          ? `module "${owner}" declares no config; remove the file`
          : `no module "${owner}" in ${packageName}; remove or rename the file`,
    }));
}

/** TOML text for a new config file holding only the schema defaults, or undefined. */
export function defaultConfigText(slot: ConfigSlot): string | undefined {
  const defaults = parseConfigResult("", "local", slot.schema);
  if (!defaultsAreValid(slot) || !defaults.ok) {
    return undefined;
  }
  const body = stringify({ default: defaults.value });
  const roundTrip = parseConfigResult(body, "local", slot.schema);
  if (
    !roundTrip.ok ||
    JSON.stringify(roundTrip.value) !== JSON.stringify(defaults.value)
  ) {
    return undefined;
  }
  return `# Created by chromatis fix from the schema defaults. Review and commit.\n${body}\n`;
}
