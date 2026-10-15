import type { ConfigEnvironment } from "../../src/config.js";

/** Where Chromatis keeps secret values: the operating system credential store. */
export const credentialService = "dev.chromatis.framework";
/**
 * Production keeps the plain service so stored values stay valid; every other
 * environment has a store of its own, so development never reads (or needs)
 * the values a deploy pushes.
 */
export const applicationService = (
  name: string,
  environment: ConfigEnvironment = "production",
): string =>
  environment === "production"
    ? `dev.chromatis.${name}`
    : `dev.chromatis.${name}.${environment}`;
export const credentialNames = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;

export async function secretValue(
  service: string,
  name: string,
): Promise<string | null> {
  return Bun.secrets.get({ service, name });
}

export type SecretLookup = (
  service: string,
  name: string,
) => Promise<string | undefined>;

/**
 * Environment variable first (CI, and Bun's automatic `.env.local` loading for
 * a git-ignored local file), then the operating system credential store.
 */
export const defaultSecretLookup: SecretLookup = async (service, name) => {
  const fromEnvironment = process.env[name];
  if (fromEnvironment) {
    return fromEnvironment;
  }
  try {
    return (await secretValue(service, name)) ?? undefined;
  } catch {
    return undefined;
  }
};

/** Names with no value, so a preflight can list every missing secret at once. */
export async function missingSecrets(
  names: readonly string[],
  service: string,
  lookup: SecretLookup = defaultSecretLookup,
): Promise<string[]> {
  const missing: string[] = [];
  for (const name of names) {
    if (!(await lookup(service, name))) {
      missing.push(name);
    }
  }
  return missing;
}

/** Values for `names`; throws naming all that are missing. */
export async function requiredSecrets(
  names: readonly string[],
  service: string,
  lookup: SecretLookup = defaultSecretLookup,
): Promise<Record<string, string>> {
  const missing = await missingSecrets(names, service, lookup);
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")} missing; run chromatis secret or set them in the environment`,
    );
  }
  const result: Record<string, string> = {};
  for (const name of names) {
    result[name] = (await lookup(service, name)) ?? "";
  }
  return result;
}
