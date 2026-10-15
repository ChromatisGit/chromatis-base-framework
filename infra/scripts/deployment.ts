import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { generateArtifacts, frameworkRoot } from "./application.js";
import { embedArtifacts, prepareArtifacts } from "./artifacts.js";
import { syncEditorSchemas } from "./editorSchemas.js";
import {
  cloudflareCredentials,
  cloudflareEnvironment,
  findWrangler,
  workerDevUrl,
} from "./cloudflare.js";
import { bundleForBun } from "./virtualModules.js";
import { writeDockerArtifacts } from "./dockerArtifacts.js";
import { renderReport, runInstanceCommand } from "./instanceCommands.js";
import { inspectInstance } from "./instanceInspect.js";
import { formatProblem } from "./problems.js";
import { DEV_OPEN_VARIABLE } from "../../src/dev.js";
import { commandEnvironment, targetOption } from "./commandOptions.js";
import { resolveApplication, instanceMode } from "./instance.js";
import { preflight } from "./preflight.js";
import type {
  BuildTarget,
  ResolvedApplication,
} from "./resolvedApplication.js";
import {
  applicationService,
  credentialNames,
  credentialService,
  defaultSecretLookup,
  requiredSecrets,
} from "./secretStore.js";
import {
  APP_DIRECTORY,
  checkTooling,
  forbiddenFiles,
  generatedCloudflareEntry,
  repairTooling,
} from "./tooling.js";
import { printPlan } from "./deployPlan.js";
import { smokeTest } from "./smoke.js";
import { secretCommand } from "./secretCommand.js";
import { materializeExternalRoutes } from "./routeMaterialize.js";

const root = process.cwd();
const wranglerPath = findWrangler(root);

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  const child = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
  });
  if (child.status !== 0) {
    throw new Error(
      `${command} ${args[0] ?? ""} failed (${child.status ?? "signal"})`,
    );
  }
}

function assertReady(failures: readonly string[]): void {
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}

/**
 * Lifecycle after config validation: run contributions, validate artifacts,
 * embed exactly those directories, then build the app for `target`.
 */
async function buildApp(
  app: ResolvedApplication,
  target: BuildTarget,
  prepared = false,
) {
  if (!prepared) {
    await prepareArtifacts(root, app);
  }
  generateArtifacts(root, app);
  embedArtifacts(root, app);
  const entry = path.join(root, APP_DIRECTORY, "entry.server.tsx");
  if (target === "cloudflare") {
    if (existsSync(entry)) {
      throw new Error(
        `${APP_DIRECTORY}/entry.server.tsx must be framework-generated; remove it and run chromatis build`,
      );
    }
    writeFileSync(entry, generatedCloudflareEntry);
  }
  const restoreRoutes = materializeExternalRoutes(root);
  try {
    run(
      "bun",
      [
        "x",
        "react-router",
        "build",
        "--config",
        path.join(frameworkRoot, "src/vite.js"),
      ],
      {
        ...process.env,
        REACT_ROUTER_ROOT: root,
        CHROMATIS_BUILD_TARGET: target,
      },
    );
  } finally {
    restoreRoutes();
    if (target === "cloudflare") {
      unlinkSync(entry);
    }
  }
  if (target === "docker") {
    const image = path.join(root, ".chromatis/image");
    mkdirSync(image, { recursive: true });
    await bundleForBun(
      root,
      path.join(root, ".chromatis/build/bun.ts"),
      path.join(image, "server.js"),
    );
    cpSync(path.join(root, "build"), path.join(image, "build"), {
      recursive: true,
      force: true,
    });
    await bundleForBun(
      root,
      path.join(root, "build/server/index.js"),
      path.join(image, "build/server/index.js"),
    );
  }
  return generateArtifacts(root, app);
}

/** `chromatis build`: ends with the checks that need no secrets or network. */
async function build(app: ResolvedApplication, target: BuildTarget) {
  const generated = await buildApp(app, target);
  assertReady(
    await preflight({
      root,
      app,
      target,
      phase: "all",
      level: "static",
      deployWranglerPath: generated.deployWranglerPath,
    }),
  );
  return generated;
}

async function deploy(
  app: ResolvedApplication,
  target: BuildTarget,
  dryRun: boolean,
  offline: boolean,
): Promise<void> {
  const level = offline ? "static" : "full";
  if (!dryRun) {
    run("bun", ["run", "check"]);
  }
  await prepareArtifacts(root, app);
  // The hook is imported by the preflight and needs the virtual modules.
  generateArtifacts(root, app);
  embedArtifacts(root, app);
  if (target === "cloudflare" && !dryRun && !offline) {
    await cloudflareCredentials(true);
  }
  assertReady(await preflight({ root, app, target, phase: "pre", level }));
  const artifacts = await buildApp(app, target, true);
  assertReady(
    await preflight({
      root,
      app,
      target,
      phase: "post",
      level,
      deployWranglerPath: artifacts.deployWranglerPath,
    }),
  );
  printPlan(app, target, dryRun, artifacts);
  if (dryRun) {
    if (target === "docker") {
      writeDockerArtifacts(root, app, {}, artifacts.output);
    }
    return;
  }
  const service = applicationService(app.name, app.environment);
  const values = await requiredSecrets(app.secrets, service);
  if (app.postgresql) {
    const { runDbMigrations } = await import("./dbMigrations.ts");
    await runDbMigrations(
      values.DATABASE_URL ?? "",
      values.DATABASE_MIGRATION_URL ?? "",
      { applicationRoot: app.packageRoot },
    );
    delete values.DATABASE_MIGRATION_URL;
  }
  for (const name of app.optionalSecrets) {
    const value = await defaultSecretLookup(service, name);
    if (value) {
      values[name] = value;
    }
  }
  let cfCredentials: Record<string, string> | undefined;
  if (target === "cloudflare") {
    const cf = await cloudflareCredentials(false);
    cfCredentials = cf;
    for (const [name, value] of Object.entries(values)) {
      const child = spawnSync(
        "bun",
        [
          wranglerPath,
          "secret",
          "put",
          name,
          "--config",
          artifacts.deployWranglerPath,
        ],
        {
          cwd: root,
          env: cloudflareEnvironment(cf),
          input: `${value}\n`,
          stdio: ["pipe", "ignore", "ignore"],
        },
      );
      if (child.status !== 0) {
        throw new Error(`Secret upload failed for ${name}`);
      }
    }
    run(
      "bun",
      [wranglerPath, "deploy", "--config", artifacts.deployWranglerPath],
      cloudflareEnvironment(cf),
    );
  } else {
    const compose = writeDockerArtifacts(root, app, values, artifacts.output);
    run("docker", ["compose", "-f", compose, "up", "--build", "-d"]);
  }
  await smokeTest(
    app,
    target,
    target === "cloudflare" && cfCredentials
      ? () => workerDevUrl(app.name, cfCredentials)
      : undefined,
  );
}

/**
 * Prints the instance diagnostics, then runs the deployment preflight. Invalid
 * configuration is reported with the diagnostics instead of aborting early.
 */
async function doctorCommand(args: string[]): Promise<void> {
  const environment = commandEnvironment("doctor", args);
  const report = await inspectInstance(root, environment);
  const failures = report.problems.map(formatProblem);
  if (report.problems.length === 0) {
    const app = await resolveApplication(root, environment);
    const generated = generateArtifacts(root, app, false);
    failures.push(
      ...(await preflight({
        root,
        app,
        target: targetOption(args, app.target),
        phase: "all",
        level: args.includes("--offline") ? "static" : "full",
        deployWranglerPath: generated.deployWranglerPath,
      })),
    );
  }
  if (args.includes("--json")) {
    console.info(JSON.stringify({ ...report, readiness: failures }, null, 2));
    process.exitCode = failures.length ? 1 : 0;
    return;
  }
  console.info(renderReport(report));
  assertReady(failures);
  console.info("[doctor] ready");
}

/** Commands that act on a resolved application. */
async function applicationCommand(
  command: string,
  args: string[],
): Promise<void> {
  const app = await resolveApplication(root, commandEnvironment(command, args));
  const target = targetOption(args, app.target);
  if (command === "build") {
    await build(app, target);
  } else if (command === "deploy") {
    await deploy(
      app,
      target,
      args.includes("--dry-run"),
      args.includes("--offline"),
    );
  } else {
    await prepareArtifacts(root, app);
    generateArtifacts(root, app);
    embedArtifacts(root, app);
    run(
      "bun",
      [
        "x",
        "react-router",
        "dev",
        "--config",
        path.join(frameworkRoot, "src/vite.js"),
      ],
      await developmentEnvironment(app, args.includes("--open")),
    );
  }
}

/**
 * What the dev server sees: this environment's stored secrets (the environment
 * variables win), and `--open` only when asked for, never inherited.
 */
async function developmentEnvironment(
  app: ResolvedApplication,
  open: boolean,
): Promise<NodeJS.ProcessEnv> {
  const service = applicationService(app.name, app.environment);
  const stored: Record<string, string> = {};
  for (const name of [...app.secrets, ...app.optionalSecrets]) {
    const value = await defaultSecretLookup(service, name);
    if (value) {
      stored[name] = value;
    }
  }
  const env: NodeJS.ProcessEnv = {
    ...stored,
    ...process.env,
    REACT_ROUTER_ROOT: root,
  };
  delete env[DEV_OPEN_VARIABLE];
  if (open) {
    env[DEV_OPEN_VARIABLE] = "1";
    console.info("[chromatis] --open: login is disabled for this dev server");
  }
  return env;
}

export async function main(): Promise<void> {
  const [command = "", ...args] = process.argv.slice(2);
  if (command === "init") {
    repairTooling(root);
    if (instanceMode(root) !== "none") {
      // First: editor help matters most while the configuration is incomplete.
      for (const problem of (await syncEditorSchemas(root)).problems) {
        console.warn(`[chromatis] editor schemas: ${formatProblem(problem)}`);
      }
      generateArtifacts(
        root,
        await resolveApplication(root, commandEnvironment(command, args)),
      );
    }
    console.info("Canonical tooling stubs repaired");
  } else if (command === "secret") {
    const app = await resolveApplication(
      root,
      commandEnvironment(command, args),
    );
    await secretCommand(args, app, {
      credentialNames,
      credentialService,
      applicationService,
    });
  } else if (command === "check-tooling") {
    const issues = [...checkTooling(root), ...forbiddenFiles(root)];
    assertReady(issues);
  } else if (command === "doctor") {
    await doctorCommand(args);
  } else if (["build", "deploy", "dev"].includes(command)) {
    await applicationCommand(command, args);
  } else if (!(await runInstanceCommand(command, args, root))) {
    throw new Error(
      "usage: chromatis <check|fix|inspect|init|check-tooling|build|dev|doctor|deploy|secret>",
    );
  }
}
