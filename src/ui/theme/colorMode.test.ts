import { expect, test } from "bun:test";
import { colorModeInitScript } from "./colorMode";

test("saved color mode is applied before paint and system leaves the root unset", () => {
  const script = colorModeInitScript("study:mode");
  const run = new Function("localStorage", "document", script);
  const root = { dataset: {} as Record<string, string> };
  run({ getItem: () => "dark" }, { documentElement: root });
  expect(root.dataset.theme).toBe("dark");
  root.dataset = {};
  run({ getItem: () => null }, { documentElement: root });
  expect(root.dataset.theme).toBeUndefined();
  expect(() =>
    run(
      {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      { documentElement: root },
    ),
  ).not.toThrow();
});
