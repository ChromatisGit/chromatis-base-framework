import { describe, expect, test } from "bun:test";
import {
  parseConfig,
  parseConfigResult,
  resolveEnvironment,
  z,
} from "./config.js";
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

  test("top-level values form the base layer under [default] and the environment", () => {
    const sectioned = z
      .object({
        deployment: z
          .object({ target: z.string(), domain: z.string() })
          .strict(),
      })
      .strict();
    const source =
      '[deployment]\ntarget = "cloudflare"\ndomain = "example.org"\n\n[local.deployment]\ndomain = "localhost"\n';
    expect(parseConfig(source, "production", sectioned)).toEqual({
      deployment: { target: "cloudflare", domain: "example.org" },
    });
    expect(parseConfig(source, "local", sectioned)).toEqual({
      deployment: { target: "cloudflare", domain: "localhost" },
    });
  });

  test("arrays are replaced by an overlay, not merged", () => {
    const lists = z.object({ items: z.array(z.string()) }).strict();
    expect(
      parseConfig(
        '[default]\nitems = ["a", "b"]\n[test]\nitems = ["c"]',
        "test",
        lists,
      ),
    ).toEqual({ items: ["c"] });
  });

  test("a misspelled environment table is an unknown key, not silently ignored", () => {
    const result = parseConfigResult(
      '[defualt]\npageSize = 20\ntitle = "x"',
      "local",
      schema,
    );
    expect(result.ok).toBe(false);
  });

  test("parseConfigResult reports every issue without throwing", () => {
    const result = parseConfigResult(
      "[default]\npageSize = -1\nextra = 1",
      "local",
      schema,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.key).sort()).toEqual([
        "configuration",
        "pageSize",
        "title",
      ]);
    }
    const syntax = parseConfigResult("= nope", "local", schema);
    expect(!syntax.ok && syntax.syntaxError !== undefined).toBe(true);
  });

  test("a non-table environment section is rejected", () => {
    expect(() => parseConfig("default = 1", "local", schema)).toThrow(
      ValidationError,
    );
  });
});
