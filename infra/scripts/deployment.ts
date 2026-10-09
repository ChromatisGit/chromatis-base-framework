import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  generateArtifacts,
  frameworkRoot,
  loadApplication,
  loadHook,
} from "./application.js";
import {
  checkTooling,
  forbiddenFiles,
  generatedCloudflareEntry,
  repairTooling,
} from "./tooling.js";
import { printPlan } from "./deployPlan.js";
import { smokeTest } from "./smoke.js";
import { promptSecret } from "./secretPrompt.js";
import { secretCommand } from "./secretCommand.js";
import { materializeExternalRoutes } from "./routeMaterialize.js";

const root = process.cwd();
const credentialService = "dev.chromatis.framework";
const applicationService = (name: string) => `dev.chromatis.${name}`;
const credentialNames = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;
const wranglerPath = path.join(
  frameworkRoot,
  "node_modules/wrangler/bin/wrangler.js",
);

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

async function secretValue(
  service: string,
  name: string,
): Promise<string | null> {
  return Bun.secrets.get({ service, name });
}

async function credentials(prompt: boolean): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of credentialNames) {
    let value = await secretValue(credentialService, name);
    if (!value && prompt) {
      value = await promptSecret(name);
      if (!value || /[\r\n]/.test(value)) {
        throw new Error(`Invalid ${name}`);
      }
      await Bun.secrets.set({ service: credentialService, name, value });
    }
    if (!value) {
      throw new Error(`${name} missing; run bun run secret`);
    }
    result[name] = value;
  }
  return result;
}

function cloudflareEnvironment(
  values: Record<string, string>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLOUDFLARE_API_TOKEN: values.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID: values.CLOUDFLARE_ACCOUNT_ID,
  };
}

async function checkCloudflare(values: Record<string, string>): Promise<void> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(values.CLOUDFLARE_ACCOUNT_ID ?? "")}/workers/scripts`,
    {
      headers: { Authorization: `Bearer ${values.CLOUDFLARE_API_TOKEN}` },
    },
  );
  if (!response.ok) {
    throw new Error(
      "Cloudflare credentials or account failed validation; run bun run secret to define CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID",
    );
  }
}

async function requiredSecrets(
  names: readonly string[],
  service: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of names) {
    const value = await secretValue(service, name);
    if (!value) {
      throw new Error(`${name} missing; run bun run secret`);
    }
    result[name] = value;
  }
  return result;
}

async function doctor(
  target: "cloudflare" | "docker",
  offline = false,
  prebuild = false,
): Promise<void> {
  const app = loadApplication(root);
  const failures = [
    ...checkTooling(root),
    ...forbiddenFiles().map(
      (file) => `${file} is forbidden; remove it and run bun run init`,
    ),
  ];
  const assets = path.join(root, "build/client");
  if (!prebuild && !existsSync(assets)) {
    failures.push("build/client missing; run bun run build");
  }
  if (!offline) {
    if (
      target === "cloudflare" &&
      (new URL(app.publicUrl).hostname === "example.com" ||
        new URL(app.publicUrl).hostname.endsWith(".example.com"))
    ) {
      failures.push(
        "publicUrl in chromatis.toml is an example domain; set the real URL and run bun run doctor --target cloudflare",
      );
    }
    try {
      await requiredSecrets(
        [
          ...app.secrets,
          ...(app.postgresql ? ["DATABASE_URL", "DATABASE_MIGRATION_URL"] : []),
        ],
        applicationService(app.name),
      );
    } catch (error) {
      failures.push((error as Error).message);
    }
    if (target === "cloudflare") {
      try {
        await checkCloudflare(await credentials(false));
      } catch (error) {
        failures.push((error as Error).message);
      }
    } else if (
      spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
        stdio: "ignore",
      }).status !== 0
    ) {
      failures.push(
        "Docker unavailable; install and start Docker, then run bun run doctor --target docker",
      );
    }
  }
  const artifacts = generateArtifacts(root, app, false);
  if (
    target === "cloudflare" &&
    !offline &&
    !prebuild &&
    failures.length === 0
  ) {
    const values = await credentials(false);
    const result = spawnSync(
      "bun",
      [
        wranglerPath,
        "deploy",
        "--dry-run",
        "--config",
        artifacts.deployWranglerPath,
      ],
      { cwd: root, env: cloudflareEnvironment(values), stdio: "ignore" },
    );
    if (result.status !== 0) {
      failures.push(
        "Generated Wrangler config invalid; run bun run build --target cloudflare",
      );
    }
  }
  if (failures.length) {
    throw new Error(failures.join("\n"));
  }
  console.info(`[doctor] ${target}: ready`);
}

function build(target: "cloudflare" | "docker") {
  const app = loadApplication(root);
  generateArtifacts(root, app);
  const entry = path.join(root, "app/entry.server.tsx");
  if (target === "cloudflare") {
    if (existsSync(entry)) {
      throw new Error(
        "app/entry.server.tsx must be framework-generated; remove it and run bun run build",
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
    run("bun", [
      "build",
      path.join(root, ".chromatis/build/bun.ts"),
      "--target=bun",
      "--outfile",
      path.join(image, "server.js"),
    ]);
    cpSync(path.join(root, "build"), path.join(image, "build"), {
      recursive: true,
      force: true,
    });
    run("bun", [
      "build",
      path.join(root, "build/server/index.js"),
      "--target=bun",
      "--outfile",
      path.join(image, "build/server/index.js"),
    ]);
  }
  return generateArtifacts(root, app);
}

function writeDockerArtifacts(
  app: ReturnType<typeof loadApplication>,
  values: Record<string, string>,
  output: string,
): string {
  const envPath = path.join(output, "app.env");
  writeFileSync(
    envPath,
    `${Object.entries({
      PORT: String(app.port),
      PUBLIC_URL: app.publicUrl,
      ...app.variables,
      ...values,
      ...Object.fromEntries(
        Object.entries(app.contentMounts).map(([name, source]) => [
          `CONTENT_${name.toUpperCase().replaceAll("-", "_")}_DIR`,
          `/content/${name}/${path.basename(source)}`,
        ]),
      ),
    })
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );
  const compose = {
    services: {
      app: {
        build: {
          context: path.join(root, ".chromatis/image"),
          dockerfile: path.join(frameworkRoot, "infra/deploy/Dockerfile"),
          args: { APP_PORT: String(app.port) },
        },
        image: `${app.name}:chromatis`,
        env_file: [envPath],
        ports: [`${app.port}:${app.port}`],
        volumes: Object.entries(app.contentMounts).map(([name, source]) => ({
          type: "bind",
          source: path.resolve(root, source),
          target: `/content/${name}/${path.basename(source)}`,
          read_only: true,
        })),
        healthcheck: {
          test: [
            "CMD",
            "bun",
            "-e",
            `fetch('http://localhost:${app.port}/_chromatis/health').then(r=>process.exit(r.ok?0:1))`,
          ],
          interval: "30s",
          timeout: "5s",
          retries: 3,
        },
      },
    },
  };
  const composePath = path.join(output, "compose.json");
  writeFileSync(composePath, `${JSON.stringify(compose, null, 2)}\n`);
  return composePath;
}

async function deploy(
  target: "cloudflare" | "docker",
  dryRun: boolean,
): Promise<void> {
  const app = loadApplication(root);
  if (checkTooling(root).length || forbiddenFiles().length) {
    await doctor(target, true);
  }
  await loadHook(root, app);
  if (!dryRun) {
    generateArtifacts(root, app);
    run("bun", ["run", "check"]);
    if (target === "cloudflare") {
      await credentials(true);
    }
    await doctor(target, false, true);
  }
  const artifacts = build(target);
  printPlan(app, target, dryRun, artifacts);
  if (dryRun) {
    if (target === "docker") {
      writeDockerArtifacts(app, {}, artifacts.output);
    }
    return;
  }
  const values = await requiredSecrets(
    [
      ...app.secrets,
      ...(app.postgresql ? ["DATABASE_URL", "DATABASE_MIGRATION_URL"] : []),
    ],
    applicationService(app.name),
  );
  if (app.postgresql) {
    run("bun", ["run", "db", "apply"], {
      ...process.env,
      DATABASE_URL: values.DATABASE_URL,
      DATABASE_MIGRATION_URL: values.DATABASE_MIGRATION_URL,
    });
    delete values.DATABASE_MIGRATION_URL;
  }
  for (const name of app.optionalSecrets) {
    const value = await secretValue(applicationService(app.name), name);
    if (value) {
      values[name] = value;
    }
  }
  if (target === "cloudflare") {
    const cf = await credentials(false);
    await doctor(target);
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
    const compose = writeDockerArtifacts(app, values, artifacts.output);
    run("docker", ["compose", "-f", compose, "up", "--build", "-d"]);
  }
  await smokeTest(root, app, target);
}

export async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "init") {
    repairTooling(root);
    if (existsSync(path.join(root, "chromatis.toml"))) {
      generateArtifacts(root, loadApplication(root));
    }
    console.info("Canonical tooling stubs repaired");
    return;
  }
  if (command === "secret") {
    await secretCommand(args, loadApplication(root), {
      credentialNames,
      credentialService,
      applicationService,
    });
    return;
  }
  const app = loadApplication(root);
  const position = args.indexOf("--target");
  const chosen = position >= 0 ? args[position + 1] : app.target;
  if (chosen !== "cloudflare" && chosen !== "docker") {
    throw new Error("--target must be cloudflare or docker");
  }
  if (command === "build") {
    build(chosen);
    return;
  }
  if (command === "doctor") {
    await doctor(chosen);
    return;
  }
  if (command === "deploy") {
    await deploy(chosen, args.includes("--dry-run"));
    return;
  }
  if (command === "dev") {
    generateArtifacts(root, app);
    run(
      "bun",
      [
        "x",
        "react-router",
        "dev",
        "--config",
        path.join(frameworkRoot, "src/vite.js"),
      ],
      { ...process.env, REACT_ROUTER_ROOT: root },
    );
    return;
  }
  if (command === "check-tooling") {
    const issues = [...checkTooling(root), ...forbiddenFiles()];
    if (issues.length) {
      throw new Error(issues.join("\n"));
    }
    return;
  }
  throw new Error(
    "usage: deployment <init|check-tooling|build|dev|doctor|deploy|secret>",
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(
      `[chromatis] ${error instanceof Error ? error.message : "Command failed"}`,
    );
    process.exitCode = 1;
  });
}
