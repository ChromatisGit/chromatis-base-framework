import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ARTIFACTS_DIRECTORY } from "./moduleSet.js";
import { InstanceProblemsError, type Problem } from "./problems.js";
import type {
  CodeReference,
  ResolvedApplication,
  ResolvedArtifact,
  ResolvedContribution,
} from "./resolvedApplication.js";

/** The argument of a build contribution. Structural: modules import no Chromatis type. */
export type ContributionContext = Readonly<{
  instanceRoot: string;
  /** `.chromatis/artifacts`; write into `<outDir>/<contribution id>/`. */
  outDir: string;
  environment: string;
  /** Validated module configuration keyed by module name. */
  config: Readonly<Record<string, unknown>>;
}>;

export type ArtifactValidation =
  Readonly<{ ok: true }> | Readonly<{ ok: false; errors: readonly string[] }>;

export const artifactsDirectory = (root: string): string =>
  path.join(root, ARTIFACTS_DIRECTORY);

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadFunction(
  code: CodeReference,
): Promise<(...args: never[]) => unknown> {
  if (!code.file) {
    throw new Error(`cannot resolve ${code.specifier}: ${code.error}`);
  }
  const loaded = (await import(pathToFileURL(code.file).href)) as Record<
    string,
    unknown
  >;
  const exported = loaded[code.export];
  if (typeof exported !== "function") {
    throw new Error(
      `${code.specifier} has no function export "${code.export}"`,
    );
  }
  return exported as (...args: never[]) => unknown;
}

const producerOf = (
  app: ResolvedApplication,
  artifact: ResolvedArtifact,
): ResolvedContribution | undefined =>
  app.contributions.find(
    (contribution) =>
      artifact.path === contribution.id ||
      artifact.path.startsWith(`${contribution.id}/`),
  );

/**
 * Runs every contribution, in id order, each into a fresh
 * `<outDir>/<id>/`. The first failure aborts with the contribution id.
 */
export async function runContributions(
  root: string,
  app: ResolvedApplication,
  outDir: string,
): Promise<void> {
  for (const contribution of app.contributions) {
    const directory = path.join(outDir, contribution.id);
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    try {
      const run = (await loadFunction(contribution.code)) as (
        context: ContributionContext,
      ) => unknown;
      await run({
        instanceRoot: root,
        outDir,
        environment: app.environment,
        config: app.moduleConfigs,
      });
    } catch (error) {
      throw new InstanceProblemsError([
        {
          source: `contribution ${contribution.id}`,
          key: `${contribution.owner} (${contribution.code.specifier})`,
          message: `failed: ${message(error)}`,
        },
      ]);
    }
  }
}

async function validateOne(
  artifact: ResolvedArtifact,
  directory: string,
): Promise<Problem[]> {
  const source = `artifact ${artifact.id}`;
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    return [
      {
        source,
        key: artifact.path,
        message: `directory is missing (${ARTIFACTS_DIRECTORY}/${artifact.path}); a contribution must produce it`,
      },
    ];
  }
  if (!artifact.validator) {
    return [];
  }
  let result: unknown;
  try {
    const validate = (await loadFunction(artifact.validator)) as (
      directory: string,
    ) => unknown;
    result = await validate(directory);
  } catch (error) {
    return [
      {
        source,
        key: artifact.path,
        message: `validator failed: ${message(error)}`,
      },
    ];
  }
  const outcome = result as { ok?: unknown; errors?: unknown } | null;
  if (outcome?.ok === true) {
    return [];
  }
  if (outcome?.ok === false && Array.isArray(outcome.errors)) {
    return outcome.errors.map((error) => ({
      source,
      key: artifact.path,
      message: String(error),
    }));
  }
  return [
    {
      source,
      key: artifact.path,
      message:
        "validator must return { ok: true } or { ok: false, errors: string[] }",
    },
  ];
}

/** Every declared artifact must exist and pass its validator; errors aggregate. */
export async function validateArtifacts(
  app: ResolvedApplication,
  directoryFor: (artifact: ResolvedArtifact) => string,
): Promise<Problem[]> {
  const problems: Problem[] = [];
  for (const artifact of app.artifacts) {
    problems.push(...(await validateOne(artifact, directoryFor(artifact))));
  }
  return problems;
}

/** Lifecycle step: run contributions into `.chromatis/artifacts`, then validate. */
export async function prepareArtifacts(
  root: string,
  app: ResolvedApplication,
): Promise<void> {
  const outDir = artifactsDirectory(root);
  mkdirSync(outDir, { recursive: true });
  await runContributions(root, app, outDir);
  const problems = await validateArtifacts(app, (artifact) =>
    path.join(outDir, artifact.path),
  );
  if (problems.length > 0) {
    throw new InstanceProblemsError(problems);
  }
}

/**
 * The non-mutating form of `prepareArtifacts` used by `check`: contributions
 * run into a temporary directory that is removed afterwards. Artifacts that no
 * contribution produces are validated where they are.
 */
export async function checkArtifacts(
  root: string,
  app: ResolvedApplication,
): Promise<Problem[]> {
  if (app.contributions.length === 0 && app.artifacts.length === 0) {
    return [];
  }
  const scratch = mkdtempSync(path.join(tmpdir(), "chromatis-check-"));
  try {
    try {
      await runContributions(root, app, scratch);
    } catch (error) {
      if (error instanceof InstanceProblemsError) {
        return [...error.problems];
      }
      throw error;
    }
    return await validateArtifacts(app, (artifact) =>
      producerOf(app, artifact)
        ? path.join(scratch, artifact.path)
        : path.join(artifactsDirectory(root), artifact.path),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Base64 file contents of a directory, keyed by relative POSIX path. */
export function directoryFiles(
  directory: string,
  prefix = "",
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(directory).sort()) {
    const relative = path.posix.join(prefix, entry);
    const file = path.join(directory, entry);
    if (statSync(file).isDirectory()) {
      Object.assign(files, directoryFiles(file, relative));
    } else if (statSync(file).isFile()) {
      files[relative] = readFileSync(file).toString("base64");
    }
  }
  return files;
}

export function directoryDigest(directory: string): string {
  const hash = createHash("sha256");
  for (const [relative, content] of Object.entries(directoryFiles(directory))) {
    hash.update(`${relative}\0${content}\0`);
  }
  return hash.digest("hex");
}

/**
 * Writes `.chromatis/build/artifacts.ts` (the `chromatis-artifacts` module) from
 * the validated directories, and `artifacts.json` with their digests so a later
 * `doctor` can tell whether the build still matches them.
 */
export function embedArtifacts(root: string, app: ResolvedApplication): void {
  const output = path.join(root, ".chromatis/build");
  mkdirSync(output, { recursive: true });
  const modules: Record<
    string,
    { basename: string; files: Record<string, string> }
  > = {};
  const digests: Record<string, { path: string; sha256: string }> = {};
  for (const artifact of app.artifacts) {
    const directory = path.join(artifactsDirectory(root), artifact.path);
    if (!existsSync(directory) || !statSync(directory).isDirectory()) {
      throw new Error(`Artifact ${artifact.id} is missing: ${directory}`);
    }
    modules[artifact.id] = {
      basename: path.basename(directory),
      files: directoryFiles(directory),
    };
    digests[artifact.id] = {
      path: artifact.path,
      sha256: directoryDigest(directory),
    };
  }
  writeFileSync(
    path.join(output, "artifacts.ts"),
    `export const artifacts: Record<string, { basename: string; files: Record<string, string> }> = ${JSON.stringify(modules)};\n`,
  );
  writeFileSync(
    path.join(output, "artifacts.json"),
    `${JSON.stringify(digests, null, 2)}\n`,
  );
}

/** Artifacts whose directory no longer matches what the build embedded. */
export function staleArtifacts(
  root: string,
  app: ResolvedApplication,
): Problem[] {
  const file = path.join(root, ".chromatis/build/artifacts.json");
  if (app.artifacts.length === 0) {
    return [];
  }
  const embedded: Record<string, { sha256: string }> = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : {};
  return app.artifacts.flatMap((artifact) => {
    const directory = path.join(artifactsDirectory(root), artifact.path);
    const current = existsSync(directory)
      ? directoryDigest(directory)
      : undefined;
    return embedded[artifact.id]?.sha256 === current
      ? []
      : [
          {
            source: `artifact ${artifact.id}`,
            key: artifact.path,
            message:
              "the build does not embed the current artifact; run chromatis build",
          },
        ];
  });
}
