export type SecretLeak = Readonly<{ key: string; message: string }>;

const SECRET_WORDS = new Set([
  "secret",
  "secrets",
  "password",
  "passwd",
  "passphrase",
  "token",
  "tokens",
  "credential",
  "credentials",
  "apikey",
  "privatekey",
]);
const SECRET_KEY_PREFIXES = new Set([
  "api",
  "private",
  "secret",
  "access",
  "signing",
  "encryption",
  "auth",
]);

function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

/** True for names such as `apiKey`, `client_secret`, `ACCESS_TOKEN`. */
export function looksLikeSecretKey(key: string): boolean {
  const parts = words(key);
  const last = parts.at(-1);
  if (last === undefined) {
    return false;
  }
  if (SECRET_WORDS.has(last)) {
    return true;
  }
  const before = parts.at(-2);
  return (
    last === "key" && before !== undefined && SECRET_KEY_PREFIXES.has(before)
  );
}

function looksLikeSecretValue(value: string): string | undefined {
  if (/:\/\/[^\s/:@]+:[^\s/@]+@/.test(value)) {
    return "contains a URL with an embedded password";
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) {
    return "contains a private key";
  }
  return undefined;
}

const normalize = (name: string): string => words(name).join("_").toUpperCase();

/**
 * Finds committed values that must not be in TOML: keys named like a declared
 * secret, keys that look like credentials, and credential-bearing values.
 */
export function findSecretLeaks(
  document: unknown,
  declaredSecrets: Iterable<string>,
): SecretLeak[] {
  const declared = new Set([...declaredSecrets].map(normalize));
  const leaks: SecretLeak[] = [];
  const hint =
    "secrets are declared by modules and supplied through the credential store or environment, never committed";

  function visit(value: unknown, path: string): void {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}.${index}`));
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        const here = path ? `${path}.${key}` : key;
        if (declared.has(normalize(key))) {
          leaks.push({
            key: here,
            message: `${key} is a declared secret; ${hint}`,
          });
        } else if (looksLikeSecretKey(key)) {
          leaks.push({
            key: here,
            message: `key looks like a secret; ${hint}`,
          });
        }
        visit(child, here);
      }
      return;
    }
    if (typeof value === "string") {
      const reason = looksLikeSecretValue(value);
      if (reason) {
        leaks.push({ key: path, message: `value ${reason}; ${hint}` });
      }
    }
  }

  visit(document, "");
  return leaks;
}
