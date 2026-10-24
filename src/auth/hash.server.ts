const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

type BunPassword = Readonly<{
  hash(password: string, options: { algorithm: "argon2id" }): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}>;

/** `Bun.password`; undefined on Cloudflare Workers. */
function bunPassword(): BunPassword | undefined {
  return (globalThis as { Bun?: { password?: BunPassword } }).Bun?.password;
}

/**
 * Hashes with Argon2id (PHC string `$argon2id$...`). PBKDF2 is only the
 * fallback of the frozen Cloudflare runtime, which has no `Bun.password`.
 */
export async function hashPin(pin: string): Promise<string> {
  const password = bunPassword();
  if (password) {
    return password.hash(pin, { algorithm: "argon2id" });
  }
  return hashPbkdf2(pin);
}

/** Verifies Argon2id hashes and the PBKDF2 hashes written before them. */
export async function verifyPin(
  pin: string,
  storedHash: string,
): Promise<boolean> {
  if (storedHash.startsWith("pbkdf2:")) {
    return verifyPbkdf2(pin, storedHash);
  }
  const password = bunPassword();
  if (!password || !storedHash.startsWith("$argon2id$")) {
    return false;
  }
  try {
    return await password.verify(pin, storedHash);
  } catch {
    return false;
  }
}

async function hashPbkdf2(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(
    new Uint8Array(SALT_LENGTH),
  ) as Uint8Array<ArrayBuffer>;
  const key = await deriveKey(pin, salt, ITERATIONS);
  return `pbkdf2:${ITERATIONS}:${toHex(salt)}:${toHex(new Uint8Array(key))}`;
}

async function verifyPbkdf2(pin: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts[0] !== "pbkdf2" || parts.length !== 4) {
    return false;
  }
  const iterations = parseInt(parts[1] ?? "", 10);
  const salt = fromHex(parts[2] ?? "") as Uint8Array<ArrayBuffer>;
  const expectedKey = fromHex(parts[3] ?? "");
  const derivedKey = new Uint8Array(await deriveKey(pin, salt, iterations));
  return timingSafeEqual(derivedKey, expectedKey);
}

async function deriveKey(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    KEY_LENGTH * 8,
  );
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  return new Uint8Array(hex.length / 2).map((_, i) =>
    parseInt(hex.slice(i * 2, i * 2 + 2), 16),
  );
}
