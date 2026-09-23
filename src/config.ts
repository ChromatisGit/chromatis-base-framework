import { parse } from "smol-toml";
import { z } from "zod";
import { ValidationError } from "./errors.js";

export const configEnvironmentSchema = z.enum(["local", "test", "production"]);
export type ConfigEnvironment = z.infer<typeof configEnvironmentSchema>;

type ConfigDocument = Readonly<{
  default?: unknown;
  local?: unknown;
  test?: unknown;
  production?: unknown;
}>;

function asRecord(value: unknown, section: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(
      `Configuration section [${section}] must be a table`,
    );
  }
  return value as Record<string, unknown>;
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

export function resolveEnvironment(
  value: string | undefined,
): ConfigEnvironment {
  return configEnvironmentSchema.parse(value ?? "local");
}

export function parseConfig<T>(
  source: string,
  environment: ConfigEnvironment,
  schema: z.ZodType<T>,
): Readonly<T> {
  let document: ConfigDocument;
  try {
    document = parse(source) as ConfigDocument;
  } catch (error) {
    throw new ValidationError(
      "Invalid TOML configuration",
      {},
      { cause: error },
    );
  }

  const merged = {
    ...asRecord(document.default, "default"),
    ...asRecord(document[environment], environment),
  };
  const result = schema.safeParse(merged);
  if (!result.success) {
    const details: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "configuration";
      (details[key] ??= []).push(issue.message);
    }
    throw new ValidationError("Configuration validation failed", details);
  }
  return freeze(result.data);
}

export { z };
