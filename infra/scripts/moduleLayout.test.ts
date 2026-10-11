import { describe, expect, test } from "bun:test";
import path from "node:path";
import { Linter } from "eslint";
import architecture from "../eslint.architecture.js";

function lint(relative: string): string[] {
  const linter = new Linter({ configType: "flat" });
  return linter
    .verify(
      "export {};",
      [
        {
          files: ["**/*.ts"],
          plugins: { chromatis: architecture },
          rules: { "chromatis/module-layout": "error" },
        },
      ],
      { filename: path.join(process.cwd(), relative) },
    )
    .map((message) => message.message);
}

describe("chromatis/module-layout", () => {
  test.each([
    "src/modules/classroom/index.ts",
    "src/modules/classroom/module.ts",
    "src/modules/classroom/module.test.ts",
    "src/modules/classroom/server/hook.ts",
  ])("allows %s", (file) => {
    expect(lint(file)).toEqual([]);
  });

  test.each([
    "src/modules/classroom/helpers.ts",
    "src/modules/classroom/module.tsx",
  ])("flags %s", (file) => {
    expect(lint(file)).toHaveLength(1);
  });
});
