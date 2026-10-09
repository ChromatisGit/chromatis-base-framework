import { describe, expect, test } from "bun:test";
import { createDatabase } from "./client.js";

const runtimeUrl =
  "postgres://chromatis_runtime:runtime@127.0.0.1:5432/chromatis";
const migrationUrl =
  "postgres://chromatis_owner:migration@127.0.0.1:5432/chromatis";

describe("database credentials", () => {
  test.each(["local", "test"] as const)(
    "%s startup requires an explicit migration credential",
    (environment) => {
      expect(() =>
        createDatabase(runtimeUrl, { runtime: "bun", environment }),
      ).toThrow("DATABASE_MIGRATION_URL is required");
    },
  );

  test("production startup accepts only the runtime credential for check-only mode", () => {
    expect(() =>
      createDatabase(runtimeUrl, {
        runtime: "bun",
        environment: "production",
      }),
    ).not.toThrow();
  });

  test("rejects a migration credential that uses the runtime role", () => {
    expect(() =>
      createDatabase(runtimeUrl, {
        runtime: "bun",
        environment: "local",
        migrationConnectionString:
          "postgres://chromatis_runtime:different-password@127.0.0.1:5432/chromatis",
      }),
    ).toThrow("must use distinct PostgreSQL roles");
  });

  test("rejects a privileged or non-standard runtime credential", () => {
    expect(() =>
      createDatabase("postgres://postgres:admin@127.0.0.1:5432/chromatis", {
        runtime: "bun",
        environment: "production",
      }),
    ).toThrow("must use the chromatis_runtime PostgreSQL role");
  });

  test("accepts distinct runtime and migration roles", () => {
    expect(() =>
      createDatabase(runtimeUrl, {
        runtime: "bun",
        environment: "local",
        migrationConnectionString: migrationUrl,
      }),
    ).not.toThrow();
  });
});
