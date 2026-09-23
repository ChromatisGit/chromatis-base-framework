import { type z } from "zod";

export type SecretDefinition = Readonly<{
  name: string;
  owner: string;
  description: string;
  required: boolean;
  schema: z.ZodType<string>;
}>;

export type SecretStatus = Readonly<{
  name: string;
  owner: string;
  description: string;
  required: boolean;
  configured: boolean;
  metadata?: Readonly<Record<string, string>>;
}>;

export interface SecretSource {
  get(name: string): string | undefined;
}

function safeUrlMetadata(
  value: string,
): Readonly<Record<string, string>> | undefined {
  try {
    const url = new URL(value);
    return {
      host: url.host,
      database: url.pathname.replace(/^\//, ""),
      user: decodeURIComponent(url.username),
      password: url.password ? "********" : "",
    };
  } catch {
    return undefined;
  }
}

export function inspectSecrets(
  definitions: readonly SecretDefinition[],
  source: SecretSource,
): readonly SecretStatus[] {
  return definitions.map((definition) => {
    const value = source.get(definition.name);
    const metadata = value?.includes("://")
      ? safeUrlMetadata(value)
      : undefined;
    return {
      name: definition.name,
      owner: definition.owner,
      description: definition.description,
      required: definition.required,
      configured:
        value !== undefined && definition.schema.safeParse(value).success,
      ...(metadata ? { metadata } : {}),
    };
  });
}

export function readSecret(
  definition: SecretDefinition,
  source: SecretSource,
): string | undefined {
  const value = source.get(definition.name);
  if (value === undefined && !definition.required) {
    return undefined;
  }
  return definition.schema.parse(value);
}
