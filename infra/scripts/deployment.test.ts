import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { checkTooling, expectedTooling, repairTooling } from "./tooling.js";
import { generateArtifacts, migrationPlan } from "./application.js";
import { printPlan } from "./deployPlan.js";
import { applicationDeclarationSchema } from "../../src/declaration.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function project(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "chromatis-deployment-"));
  directories.push(directory);
  return directory;
}

test("canonical tooling accepts pristine stubs and rejects either modified stub", () => {
  const root = project();
  repairTooling(root);
  expect(checkTooling(root)).toEqual([]);
  for (const [file, expected] of Object.entries(expectedTooling())) {
    writeFileSync(path.join(root, file), `${expected}modified\n`);
    expect(checkTooling(root)).toContain(
      `${file} differs from the framework stub; run bun run init`,
    );
    repairTooling(root);
    expect(readFileSync(path.join(root, file), "utf8")).toBe(expected);
    expect(checkTooling(root)).toEqual([]);
  }
});

test("runtime migrations append new tags without changing earlier entries", () => {
  const root = project();
  const first = migrationPlan(root, ["classroom"], true);
  expect(first).toEqual([{ tag: "v1", new_classes: ["Runtime_classroom"] }]);
  expect(migrationPlan(root, ["classroom"], true)).toEqual(first);
  const second = migrationPlan(root, ["classroom", "quiz"], true);
  expect(second[0]).toEqual(first[0]);
  expect(second[1]).toEqual({ tag: "v2", new_classes: ["Runtime_quiz"] });
  const third = migrationPlan(root, ["quiz"], true);
  expect(third.slice(0, 2)).toEqual(second);
  expect(third[2]).toEqual({
    tag: "v3",
    deleted_classes: ["Runtime_classroom"],
  });
});

test("doctor input rejects a rewritten runtime migration tag", () => {
  const root = project();
  mkdirSync(path.join(root, ".chromatis"), { recursive: true });
  writeFileSync(
    path.join(root, ".chromatis/runtime-migrations.json"),
    JSON.stringify({
      migrations: [{ tag: "v9", new_classes: ["Runtime_classroom"] }],
    }),
  );
  expect(() => migrationPlan(root, ["classroom"], false)).toThrow(
    "migration tags are inconsistent",
  );
});

test("dry-run plan names secrets and variables without showing their values", () => {
  const app = applicationDeclarationSchema.parse({
    name: "example",
    publicUrl: "https://example.com",
    secrets: ["API_KEY"],
    variables: { DIRECTORY_URL: "SENTINEL_VARIABLE_VALUE" },
  });
  const previous = console.info;
  let output = "";
  console.info = (value) => {
    output += String(value);
  };
  try {
    printPlan(app, "cloudflare", true, {
      output: ".chromatis/build",
      migrations: [],
    });
  } finally {
    console.info = previous;
  }
  expect(output).toContain("API_KEY");
  expect(output).toContain("DIRECTORY_URL");
  expect(output).not.toContain("SENTINEL_VARIABLE_VALUE");
});

test("fake secret values stay out of generated Worker and deployment files", () => {
  const root = project();
  const app = applicationDeclarationSchema.parse({
    name: "example",
    publicUrl: "https://example.com",
    secrets: ["API_KEY"],
  });
  const previous = process.env.API_KEY;
  process.env.API_KEY = "SENTINEL_SECRET_VALUE";
  try {
    const artifacts = generateArtifacts(root, app);
    const files = [
      artifacts.wranglerPath,
      path.join(artifacts.output, "worker.ts"),
      path.join(artifacts.output, "bun.ts"),
      path.join(root, "react-router.config.ts"),
    ];
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toContain("SENTINEL_SECRET_VALUE");
    }
  } finally {
    if (previous === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previous;
    }
  }
});
