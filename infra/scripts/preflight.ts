import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadHook, migrationPlan } from "./application.js";
import {
  artifactsDirectory,
  staleArtifacts,
  validateArtifacts,
} from "./artifacts.js";
import {
  checkCloudflare,
  cloudflareCredentials,
  cloudflareEnvironment,
  findWrangler,
} from "./cloudflare.js";
import { formatProblem } from "./problems.js";
import type {
  BuildTarget,
  ResolvedApplication,
} from "./resolvedApplication.js";
import {
  applicationService,
  defaultSecretLookup,
  missingSecrets,
  type SecretLookup,
} from "./secretStore.js";
import { checkTooling, forbiddenFiles } from "./tooling.js";

export type PreflightOptions = Readonly<{
  root: string;
  app: ResolvedApplication;
  target: BuildTarget;
  /** `pre`: what can be judged before the build; `post`: what needs its output. */
  phase: "pre" | "post" | "all";
  /** `static` never reads secrets or contacts a platform. */
  level: "static" | "full";
  lookup?: SecretLookup;
  /** Generated Wrangler config; required for the `post` phase on Cloudflare. */
  deployWranglerPath?: string;
}>;

function attempt<T>(action: () => T, failures: string[], prefix = ""): void {
  try {
    action();
  } catch (error) {
    failures.push(
      `${prefix}${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Static checks that need no build output. */
async function staticChecks(options: PreflightOptions, failures: string[]) {
  const { root, app } = options;
  failures.push(
    ...checkTooling(root),
    ...forbiddenFiles(root).map(
      (file) => `${file} is forbidden; remove it and run chromatis init`,
    ),
    ...(
      await validateArtifacts(app, (artifact) =>
        path.join(artifactsDirectory(root), artifact.path),
      )
    ).map(formatProblem),
  );
  try {
    await loadHook(app);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  attempt(() => migrationPlan(root, app.runtime, false), failures);
  if (app.postgresql) {
    const { checkApplicationSecurity } = await import("./accessMigrations.ts");
    const { checkGeneratedMigrationStates } =
      await import("./dbGeneratedMigrations.ts");
    attempt(() => checkGeneratedMigrationStates(app.packageRoot), failures);
    failures.push(
      ...checkApplicationSecurity(app.packageRoot).problems.map(
        (problem) => `security: ${problem}`,
      ),
    );
  }
}

async function databaseChecks(
  options: PreflightOptions,
  failures: string[],
): Promise<void> {
  const lookup = options.lookup ?? defaultSecretLookup;
  const url = await lookup(
    applicationService(options.app.name),
    "DATABASE_URL",
  );
  if (!url) {
    return;
  }
  try {
    const { getPendingMigrations } = await import("./dbMigrations.ts");
    const pending = await getPendingMigrations(url, options.app.packageRoot);
    if (pending.length > 0) {
      console.info(
        `[preflight] ${pending.length} pending migration(s) will be applied by deploy`,
      );
    }
  } catch (error) {
    failures.push(
      `database: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function targetChecks(
  options: PreflightOptions,
  failures: string[],
): Promise<void> {
  const { app, target } = options;
  const lookup = options.lookup ?? defaultSecretLookup;
  const hostname = new URL(app.publicUrl).hostname;
  if (target === "cloudflare") {
    if (hostname === "example.com" || hostname.endsWith(".example.com")) {
      failures.push(
        `${app.publicUrl} is an example domain; set the real [deployment] domain before deploying to Cloudflare`,
      );
    }
    if (hostname === "localhost") {
      failures.push(
        "[deployment] domain is localhost; Cloudflare needs the public domain",
      );
    }
  }
  const missing = await missingSecrets(
    app.secrets,
    applicationService(app.name),
    lookup,
  );
  if (missing.length > 0) {
    failures.push(
      `missing secrets for ${app.environment}: ${missing.join(", ")}; run chromatis secret (or set them in the environment)`,
    );
  }
  if (target === "cloudflare") {
    if (!existsSync(findWrangler(options.root))) {
      failures.push("wrangler is not installed; run bun install");
    }
    try {
      await checkCloudflare(await cloudflareCredentials(false, lookup));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  } else if (
    spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "ignore",
    }).status !== 0
  ) {
    failures.push(
      "Docker unavailable; install and start Docker, then run chromatis doctor --target docker",
    );
  }
  if (app.postgresql && !missing.includes("DATABASE_URL")) {
    await databaseChecks(options, failures);
  }
}

async function postChecks(
  options: PreflightOptions,
  failures: string[],
): Promise<void> {
  const { root, app, target, level } = options;
  if (!existsSync(path.join(root, "build/client"))) {
    failures.push("build/client missing; run chromatis build");
  }
  failures.push(...staleArtifacts(root, app).map(formatProblem));
  if (
    target === "cloudflare" &&
    level === "full" &&
    options.deployWranglerPath &&
    failures.length === 0
  ) {
    const result = spawnSync(
      "bun",
      [
        findWrangler(root),
        "deploy",
        "--dry-run",
        "--config",
        options.deployWranglerPath,
      ],
      {
        cwd: root,
        env: cloudflareEnvironment(
          await cloudflareCredentials(false, options.lookup),
        ),
        stdio: "ignore",
      },
    );
    if (result.status !== 0) {
      failures.push(
        "Generated Wrangler config invalid; run chromatis build --target cloudflare",
      );
    }
  }
}

/** Deployment prerequisites as one aggregated, actionable list; empty means ready. */
export async function preflight(options: PreflightOptions): Promise<string[]> {
  const failures: string[] = [];
  if (options.phase !== "post") {
    await staticChecks(options, failures);
    if (options.level === "full") {
      await targetChecks(options, failures);
    }
  }
  if (options.phase !== "pre") {
    await postChecks(options, failures);
  }
  return failures;
}
