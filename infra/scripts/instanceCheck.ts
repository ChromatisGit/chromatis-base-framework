import { extraRouteProblems, loadExtraRoutes } from "./routes.js";
import { checkArtifacts } from "./artifacts.js";
import { editorSchemaProblems, planEditorSchemas } from "./editorSchemas.js";
import type { ConfigEnvironment } from "../../src/config.js";
import { CHECK_ACTIVE, runGates } from "./gates.js";
import { applicationFrom, loadInstance, type Instance } from "./instance.js";
import { formatProblem, type Problem } from "./problems.js";
import { checkTooling, forbiddenFiles } from "./tooling.js";

export type CheckContext = Readonly<{
  root: string;
  /** Every environment's configuration is validated. */
  instance: Instance;
  scripts: boolean;
}>;

export type CheckStage = Readonly<{
  name: string;
  run: (
    context: CheckContext,
  ) => readonly Problem[] | Promise<readonly Problem[]>;
}>;

const toolingStage: CheckStage = {
  name: "tooling",
  run: ({ root }) =>
    [...checkTooling(root), ...forbiddenFiles(root)].map((message) => ({
      source: "tooling",
      message,
    })),
};

/** Discovery, module declarations, config files, secrets hygiene. */
const instanceStage: CheckStage = {
  name: "instance",
  run: ({ instance }) => instance.problems,
};

/**
 * Contributions run into a temporary directory (the instance is not touched),
 * then every declared artifact is validated: a missing, invalid or incompatible
 * catalog fails here instead of at runtime. Needs a valid configuration.
 */
const artifactsStage: CheckStage = {
  name: "artifacts",
  run: ({ root, instance }) =>
    instance.problems.length > 0
      ? []
      : checkArtifacts(root, applicationFrom(instance)),
};

/**
 * Route files exist (resolved with the instance), ids and paths are unique, and
 * the instance's own `app/routes.ts` does not collide with the product's.
 * Package-level problems are part of the instance stage; this one executes the
 * instance's route config.
 */
const routesStage: CheckStage = {
  name: "routes",
  run: async ({ root, instance }) => {
    if (instance.problems.length > 0) {
      return [];
    }
    const extra = await loadExtraRoutes(root);
    return [
      ...extra.problems,
      ...(extra.routes ? extraRouteProblems(instance.shell, extra.routes) : []),
    ];
  },
};

/**
 * Editor support: the generated schemas are current and every hand-written
 * TOML file names its schema (see editorSchemas.ts). Fixed by `chromatis fix`.
 */
const editorStage: CheckStage = {
  name: "editor",
  run: async ({ root, instance }) =>
    editorSchemaProblems(root, await planEditorSchemas(instance)),
};

/** The instance's typecheck, lint, format and test gates (see runGates). */
const scriptsStage: CheckStage = {
  name: "scripts",
  run: ({ root, scripts }) =>
    scripts && !process.env[CHECK_ACTIVE] ? runGates(root) : [],
};

/**
 * Ordered, non-mutating checks. Add further stages here; each reads
 * `context.instance` (modules, config, effective environment).
 */
export const checkStages: readonly CheckStage[] = [
  toolingStage,
  instanceStage,
  artifactsStage,
  routesStage,
  editorStage,
  scriptsStage,
];

export type CheckOptions = Readonly<{
  environment?: ConfigEnvironment;
  /** Run the instance's own typecheck/lint/format/test scripts (default true). */
  scripts?: boolean;
}>;

async function checkContext(
  root: string,
  options: CheckOptions,
): Promise<CheckContext> {
  return {
    root,
    scripts: options.scripts ?? true,
    instance: await loadInstance(root, options.environment ?? "local"),
  };
}

export async function checkInstance(
  root: string,
  options: CheckOptions = {},
): Promise<Problem[]> {
  const context = await checkContext(root, options);
  const problems: Problem[] = [];
  for (const stage of checkStages) {
    problems.push(...(await stage.run(context)));
  }
  return problems;
}

/** Discovery, declarations, config files and secrets hygiene only. */
export async function instanceProblems(root: string): Promise<Problem[]> {
  return [
    ...(await instanceStage.run(await checkContext(root, { scripts: false }))),
  ];
}

export function problemsError(heading: string, problems: readonly Problem[]) {
  return new Error(
    `${heading}: ${problems.length} problem(s)\n${problems.map((p) => `  ${formatProblem(p)}`).join("\n")}`,
  );
}
