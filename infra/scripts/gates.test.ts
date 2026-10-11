import { afterEach, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { formatTargets } from "./gates.js";
import { formatWithPrettier } from "./instanceFix.js";
import {
  APP_TOML,
  cleanupFixtures,
  createInstance,
} from "./instanceFixture.js";

afterEach(cleanupFixtures);

test("fix formats the files the format gate checks: the script's paths, else the defaults", async () => {
  const { root } = await createInstance({
    modules: {},
    config: { "app.toml": APP_TOML },
    scripts: { "format:check": "prettier app src package.json --check" },
  });
  mkdirSync(path.join(root, "app"));
  expect(formatTargets(root)).toEqual(["app", "package.json"]);

  const plain = await createInstance({
    modules: {},
    config: { "app.toml": APP_TOML },
  });
  mkdirSync(path.join(plain.root, "server"));
  expect(formatTargets(plain.root)).toEqual(["server", "package.json"]);
});

test("formatting is skipped, not failed, without Prettier", async () => {
  const { root } = await createInstance({
    modules: {},
    config: { "app.toml": APP_TOML },
  });
  expect(formatWithPrettier(root)).toBeUndefined();
});

test("fix runs the installed Prettier on exactly those targets, found even when hoisted", async () => {
  const { root } = await createInstance({
    workspace: true,
    modules: {},
    config: { "app.toml": APP_TOML },
  });
  mkdirSync(path.join(root, "app"));
  const bin = path.join(path.dirname(root), "node_modules/.bin");
  mkdirSync(bin, { recursive: true });
  await Bun.write(
    path.join(bin, "prettier"),
    `#!/bin/sh\necho "$@" > "${root}/prettier.args"\n`,
  );
  Bun.spawnSync(["chmod", "+x", path.join(bin, "prettier")]);
  expect(formatWithPrettier(root)).toEqual(["app", "package.json"]);
  expect((await Bun.file(path.join(root, "prettier.args")).text()).trim()).toBe(
    "--write app package.json",
  );
});
