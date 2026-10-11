import { parse } from "smol-toml";
import { z } from "zod";
import { ValidationError } from "./errors.js";

export const configEnvironmentSchema = z.enum(["local", "test", "production"]);
export type ConfigEnvironment = z.infer<typeof configEnvironmentSchema>;

export const CONFIG_ENVIRONMENTS = configEnvironmentSchema.options;

/** One validation failure: the key path inside the merged configuration. */
export type ConfigIssue = Readonly<{ key: string; message: string }>;

export type ConfigResult<T> =
  | Readonly<{ ok: true; value: Readonly<T> }>
  | Readonly<{
      ok: false;
      issues: readonly ConfigIssue[];
      /** Set when the source is not valid TOML. */
      syntaxError?: unknown;
    }>;

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    freeze(child);
  }
  return value;
}

/** Tables merge recursively; every other value (arrays included) is replaced. */
function mergeTables(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = result[key];
    result[key] =
      isTable(existing) && isTable(value)
        ? mergeTables(existing, value)
        : value;
  }
  return result;
}

/**
 * "Required" for a key nobody set, instead of "expected array, received
 * undefined" (a missing enum or union is not an `invalid_type` issue).
 */
const missingValue = (issue: z.core.$ZodRawIssue): string | undefined =>
  (issue.code === "invalid_type" ||
    issue.code === "invalid_value" ||
    issue.code === "invalid_union") &&
  issue.input === undefined
    ? "Required"
    : undefined;

export function resolveEnvironment(
  value: string | undefined,
): ConfigEnvironment {
  return configEnvironmentSchema.parse(value ?? "local");
}

function section(
  document: Record<string, unknown>,
  name: string,
): { table: Record<string, unknown> } | { issue: ConfigIssue } {
  const value = document[name];
  if (value === undefined) {
    return { table: {} };
  }
  if (!isTable(value)) {
    return {
      issue: {
        key: name,
        message: `Configuration section [${name}] must be a table`,
      },
    };
  }
  return { table: value };
}

/**
 * Layers, lowest to highest precedence: top-level values outside the
 * environment tables, `[default]`, then the selected environment table.
 * Tables merge recursively, so `[production.deployment]` overrides single keys
 * of `[deployment]`. Never throws; reports every failure as an issue.
 */
export function parseConfigResult<T>(
  source: string,
  environment: ConfigEnvironment,
  schema: z.ZodType<T>,
): ConfigResult<T> {
  let document: Record<string, unknown>;
  try {
    document = parse(source);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          key: "configuration",
          message: `Invalid TOML: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      syntaxError: error,
    };
  }

  const base = Object.fromEntries(
    Object.entries(document).filter(
      ([key]) =>
        !(CONFIG_ENVIRONMENTS as readonly string[]).includes(key) &&
        key !== "default",
    ),
  );
  const layers = [section(document, "default"), section(document, environment)];
  const issues = layers.flatMap((layer) =>
    "issue" in layer ? [layer.issue] : [],
  );
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const merged = layers.reduce(
    (result, layer) =>
      "table" in layer ? mergeTables(result, layer.table) : result,
    base,
  );
  const result = schema.safeParse(merged, { error: missingValue });
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        key: issue.path.join(".") || "configuration",
        message: issue.message,
      })),
    };
  }
  return { ok: true, value: freeze(result.data) };
}

export function parseConfig<T>(
  source: string,
  environment: ConfigEnvironment,
  schema: z.ZodType<T>,
): Readonly<T> {
  const result = parseConfigResult(source, environment, schema);
  if (result.ok) {
    return result.value;
  }
  if (result.syntaxError !== undefined) {
    throw new ValidationError(
      "Invalid TOML configuration",
      {},
      { cause: result.syntaxError },
    );
  }
  const details: Record<string, string[]> = {};
  for (const issue of result.issues) {
    (details[issue.key] ??= []).push(issue.message);
  }
  throw new ValidationError("Configuration validation failed", details);
}

export { z };
