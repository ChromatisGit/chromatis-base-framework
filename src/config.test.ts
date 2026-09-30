import { describe, expect, test } from "bun:test";
import { parseConfig, resolveEnvironment, z } from "./config.js";
import { ValidationError } from "./errors.js";

const schema = z
  .object({
    pageSize: z.number().int().positive(),
    title: z.string(),
  })
  .strict();

describe("configuration", () => {
  test("overlays the selected environment and freezes the result", () => {
    const config = parseConfig(
      '[default]\npageSize = 20\ntitle = "Local"\n\n[production]\npageSize = 100',
      "production",
      schema,
    );
    expect(config).toEqual({ pageSize: 100, title: "Local" });
    expect(Object.isFrozen(config)).toBe(true);
  });

  test("rejects unknown keys", () => {
    expect(() =>
      parseConfig(
        '[default]\npageSize = 20\ntitle = "x"\nextra = true',
        "local",
        schema,
      ),
    ).toThrow(ValidationError);
  });

  test("defaults the environment to local", () => {
    expect(resolveEnvironment(undefined)).toBe("local");
  });
});
