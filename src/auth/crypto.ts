import * as argon2 from "argon2";

export async function hashPin(pin: string): Promise<string> {
  return argon2.hash(pin, { type: argon2.argon2id });
}

export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, pin);
  } catch {
    return false;
  }
}
