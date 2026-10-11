import { describe, expect, test } from "bun:test";
import { findSecretLeaks, looksLikeSecretKey } from "./secretHygiene.js";
import { secretEntries } from "./secretCommand.js";

describe("secret hygiene", () => {
  test.each([
    "apiKey",
    "api_key",
    "API-KEY",
    "clientSecret",
    "ACCESS_TOKEN",
    "password",
    "dbPassword",
    "privateKey",
    "signing_key",
    "credentials",
  ])("%s looks like a secret", (key) => {
    expect(looksLikeSecretKey(key)).toBe(true);
  });

  test.each([
    "tokenTtlSeconds",
    "passwordMinLength",
    "secretsDirectory",
    "keyboard",
    "primaryKey",
    "maxStudents",
    "publicKeyUrl",
    "courses",
  ])("%s is ordinary configuration", (key) => {
    expect(looksLikeSecretKey(key)).toBe(false);
  });

  test("finds declared secret names at any depth, in any spelling", () => {
    const leaks = findSecretLeaks(
      { default: { nested: [{ catalogSalt: "x" }] }, CATALOG_SALT: "y" },
      ["CATALOG_SALT"],
    );
    expect(leaks.map((leak) => leak.key)).toEqual([
      "default.nested.0.catalogSalt",
      "CATALOG_SALT",
    ]);
  });

  test("finds credential-bearing values but not plain URLs", () => {
    expect(
      findSecretLeaks(
        { a: "https://user:pw@host/x", b: "https://host/x" },
        [],
      ).map((leak) => leak.key),
    ).toEqual(["a"]);
    expect(
      findSecretLeaks({ k: "-----BEGIN RSA PRIVATE KEY-----\nabc" }, []),
    ).toHaveLength(1);
  });
});

describe("secret command", () => {
  test("lists Cloudflare credentials and then every declared secret", () => {
    const entries = secretEntries(
      {
        name: "demo",
        declaredSecrets: [
          { name: "A", owner: "m", description: "d", requirement: "always" },
          {
            name: "B",
            owner: "m",
            description: "d",
            requirement: "production",
          },
        ],
      },
      {
        credentialNames: ["CF_TOKEN"],
        credentialService: "framework",
        applicationService: (name) => `app.${name}`,
      },
    );
    expect(entries).toEqual([
      { name: "CF_TOKEN", kind: "credential", service: "framework" },
      { name: "A", kind: "required", service: "app.demo" },
      { name: "B", kind: "production", service: "app.demo" },
    ]);
  });
});
