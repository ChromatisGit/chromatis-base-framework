import { describe, expect, test } from "bun:test";
import { hashPin, verifyPin } from "./hash.server.js";

describe("PIN hashing", () => {
  test("new hashes are Argon2id and verify only the right PIN", async () => {
    const hash = await hashPin("1234");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPin("1234", hash)).toBe(true);
    expect(await verifyPin("1235", hash)).toBe(false);
  });

  test("PBKDF2 hashes written before Argon2id still verify", async () => {
    // pbkdf2:<iterations>:<salt>:<key> for PIN "1234" with salt 00..0f.
    const salt = new Uint8Array(16).map((_, index) => index);
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("1234"),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const key = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 1000 },
      material,
      256,
    );
    const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
    const stored = `pbkdf2:1000:${hex(salt)}:${hex(new Uint8Array(key))}`;
    expect(await verifyPin("1234", stored)).toBe(true);
    expect(await verifyPin("1235", stored)).toBe(false);
  });

  test("unknown or malformed hashes never verify", async () => {
    for (const stored of ["", "plain", "$2b$10$abc", "$argon2id$broken"]) {
      expect(await verifyPin("1234", stored)).toBe(false);
    }
  });
});
