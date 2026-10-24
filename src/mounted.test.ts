import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  MountedInstanceError,
  loadMountedArtifacts,
  loadMountedConfig,
} from "./mounted.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function mount(files: Record<string, string>): Record<string, string> {
  const root = mkdtempSync(path.join(tmpdir(), "chromatis-mounted-"));
  directories.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return { CHROMATIS_INSTANCE: root, PUBLIC_URL: "https://school.example" };
}

const catalog = {
  name: "catalog",
  required: true,
  declaration: {
    config: {
      schema: z.object({ courses: z.array(z.string()).min(1) }).strict(),
    },
  },
};
const classroom = {
  name: "classroom",
  required: false,
  declaration: {
    config: {
      schema: z.object({ max_sessions: z.number().default(500) }).strict(),
    },
  },
};

function problems(load: () => unknown): readonly string[] {
  try {
    load();
  } catch (error) {
    if (error instanceof MountedInstanceError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

describe("mounted configuration", () => {
  test("validates each module's file with its schema, production overlays applied", () => {
    const env = mount({
      "config/catalog.toml": 'courses = ["a"]\n[production]\ncourses = ["b"]\n',
    });
    expect(loadMountedConfig("studyluma", [catalog, classroom], env)).toEqual({
      config: { catalog: { courses: ["b"] }, classroom: { max_sessions: 500 } },
      app: {
        name: "studyluma",
        domain: "school.example",
        publicUrl: "https://school.example",
        environment: "production",
      },
    });
  });

  test("reports every problem at once", () => {
    const env = mount({
      "config/classroom.toml": 'max_sessions = "many"\n',
      "config/app.toml": "",
      "config/directory.toml": "",
    });
    expect(
      problems(() =>
        loadMountedConfig("studyluma", [catalog, classroom], {
          ...env,
          PUBLIC_URL: undefined,
        }),
      ),
    ).toEqual([
      "config/app.toml belongs to the image; deployment settings come from the environment",
      'config/directory.toml: the image has no module "directory" with configuration',
      "config/catalog.toml is missing",
      "config/classroom.toml: max_sessions: Invalid input: expected number, received string",
      "PUBLIC_URL must be the public address, such as https://example.org",
    ]);
  });
});

describe("mounted artifacts", () => {
  test("are read in the shape a build embeds, after their validator", async () => {
    const env = mount({ "artifacts/catalog/catalog.json": "{}" });
    const seen: string[] = [];
    const artifacts = await loadMountedArtifacts(
      [
        {
          id: "catalog",
          path: "catalog",
          validate: (directory) => {
            seen.push(path.basename(directory));
            return { ok: true };
          },
        },
      ],
      env,
    );
    expect(seen).toEqual(["catalog"]);
    expect(artifacts).toEqual({
      catalog: { basename: "catalog", files: { "catalog.json": "e30=" } },
    });
  });

  test("a missing or rejected artifact stops the start", async () => {
    const env = mount({ "artifacts/catalog/catalog.json": "{}" });
    const failure = await loadMountedArtifacts(
      [
        {
          id: "catalog",
          path: "catalog",
          validate: () => ({ ok: false, errors: ["format 3 is newer"] }),
        },
        { id: "extra", path: "extra" },
      ],
      env,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MountedInstanceError);
    expect((failure as MountedInstanceError).problems).toEqual([
      "artifacts/catalog: format 3 is newer",
      "artifacts/extra is missing (artifact extra)",
    ]);
  });
});
