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
  test("hides automatically supplied local database credentials only in local mode", () => {
    const services = {
      credentialNames: [],
      credentialService: "framework",
      applicationService: () => "app",
    };
    const declaredSecrets = [
      {
        name: "DATABASE_URL",
        owner: "chromatis",
        description: "database",
        requirement: "always" as const,
      },
    ];
    const previous = process.env.CHROMATIS_DEV_DATABASE;
    try {
      delete process.env.CHROMATIS_DEV_DATABASE;
      expect(
        secretEntries(
          { name: "demo", environment: "local", declaredSecrets },
          services,
        ),
      ).toHaveLength(0);
      expect(
        secretEntries(
          { name: "demo", environment: "production", declaredSecrets },
          services,
        ),
      ).toHaveLength(1);
      process.env.CHROMATIS_DEV_DATABASE = "external";
      expect(
        secretEntries(
          { name: "demo", environment: "local", declaredSecrets },
          services,
        ),
      ).toHaveLength(1);
    } finally {
      if (previous === undefined) {
        delete process.env.CHROMATIS_DEV_DATABASE;
      } else {
        process.env.CHROMATIS_DEV_DATABASE = previous;
      }
    }
  });

  test("lists Cloudflare credentials and then every declared secret", () => {
    const entries = secretEntries(
      {
        name: "demo",
        environment: "production",
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
        applicationService: (name, environment) => `app.${name}.${environment}`,
      },
    );
    expect(entries).toEqual([
      { name: "CF_TOKEN", kind: "credential", service: "framework" },
      { name: "A", kind: "required", service: "app.demo.production" },
      { name: "B", kind: "production", service: "app.demo.production" },
    ]);
  });
});

describe("applicationService", () => {
  test("keeps the production store and gives other environments their own", async () => {
    const { applicationService } = await import("./secretStore.js");
    expect(applicationService("holst")).toBe("dev.chromatis.holst");
    expect(applicationService("holst", "production")).toBe(
      "dev.chromatis.holst",
    );
    expect(applicationService("holst", "local")).toBe(
      "dev.chromatis.holst.local",
    );
  });
});
