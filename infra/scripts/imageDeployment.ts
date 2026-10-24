import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  MOUNTED_ARTIFACTS,
  MOUNTED_CONFIG,
  MOUNTED_SITE,
} from "../../src/mounted.js";
import { frameworkRoot } from "./application.js";
import { artifactsDirectory } from "./artifacts.js";
import { CONFIG_DIRECTORY } from "./instanceConfig.js";
import type { ResolvedApplication } from "./resolvedApplication.js";
import { bundleForBun } from "./virtualModules.js";

/**
 * Image deployments: one published image (built from an instance with
 * `instance = "mounted"`) runs many instances. The instance contributes only
 * files: its module configuration, its artifacts and its prerendered pages
 * (`.chromatis/mount`). `chromatis deploy` puts them next to the framework's
 * compose project (`infra/deploy`) and starts it, on this machine or over SSH.
 */
export const MOUNT_DIRECTORY = ".chromatis/mount";
export const DEPLOY_DIRECTORY = ".chromatis/deploy";
const DEPLOY_FILES = [
  "compose.yaml",
  "Caddyfile",
  "postgres/init-roles.sh",
  "backup.sh",
  "restore.sh",
];

/** The compose project's database passwords; the URLs are derived from them. */
export const DATABASE_PASSWORDS = [
  "POSTGRES_PASSWORD",
  "DATABASE_OWNER_PASSWORD",
  "DATABASE_AUTH_PASSWORD",
  "DATABASE_RUNTIME_PASSWORD",
];
const DERIVED = new Set([
  "DATABASE_URL",
  "DATABASE_AUTH_URL",
  "DATABASE_MIGRATION_URL",
]);

/** The secrets a deployment needs: for an image, passwords instead of URLs. */
export const deploymentSecrets = (app: ResolvedApplication): string[] =>
  app.image
    ? [
        ...app.secrets.filter((name) => !DERIVED.has(name)),
        ...DATABASE_PASSWORDS,
      ]
    : [...app.secrets];

/**
 * The image build context of a mounted instance besides `server.js` and
 * `build/client`: `migrate.js`, which the compose project runs before the app,
 * and the product's migrations, which both read from `src/modules`.
 */
export async function writeImageContext(
  root: string,
  app: ResolvedApplication,
  image: string,
): Promise<void> {
  const entry = path.join(root, ".chromatis/build/migrate.ts");
  writeFileSync(
    entry,
    app.postgresql
      ? [
          `import { runDbMigrations } from ${JSON.stringify(path.join(frameworkRoot, "infra/scripts/dbMigrations.ts"))};`,
          'await runDbMigrations(process.env.DATABASE_URL ?? "", process.env.DATABASE_MIGRATION_URL ?? "");',
          'console.info("[migrate] the database is current");',
          "",
        ].join("\n")
      : 'console.info("[migrate] no module uses PostgreSQL");\n',
  );
  await bundleForBun(root, entry, path.join(image, "migrate.js"));
  await bundleCommands(root, app, image);
  const modules = path.join(app.packageRoot, "src/modules");
  rmSync(path.join(image, "src"), { recursive: true, force: true });
  if (!existsSync(modules)) {
    return;
  }
  for (const module of readdirSync(modules)) {
    for (const part of ["migrations", "sql"]) {
      const from = path.join(modules, module, part);
      if (existsSync(from)) {
        cpSync(from, path.join(image, "src/modules", module, part), {
          recursive: true,
        });
      }
    }
  }
}

/** The product's `bin` commands, bundled into `bin/` of the image (on PATH). */
async function bundleCommands(
  root: string,
  app: ResolvedApplication,
  image: string,
): Promise<void> {
  const manifest = JSON.parse(
    readFileSync(path.join(app.packageRoot, "package.json"), "utf8"),
  ) as { bin?: string | Record<string, string> };
  const commands =
    typeof manifest.bin === "string"
      ? { [path.basename(app.packageRoot)]: manifest.bin }
      : (manifest.bin ?? {});
  rmSync(path.join(image, "bin"), { recursive: true, force: true });
  for (const [name, file] of Object.entries(commands)) {
    const target = path.join(image, "bin", name);
    await bundleForBun(root, path.resolve(app.packageRoot, file), target);
    const code = readFileSync(target, "utf8").replace(/^#!.*\n/, "");
    writeFileSync(target, `#!/usr/bin/env bun\n${code}`);
    chmodSync(target, 0o755);
  }
}

/**
 * `.chromatis/mount`: what the image reads (`config/`, `artifacts/`) and what
 * Caddy serves in front of it (`site/`: the prerendered pages and every other
 * file of the client build, without the build's own `index.html`).
 */
export function exportMount(
  root: string,
  app: ResolvedApplication,
  pages: readonly string[],
): string {
  const mount = path.join(root, MOUNT_DIRECTORY);
  rmSync(mount, { recursive: true, force: true });
  mkdirSync(path.join(mount, MOUNTED_CONFIG), { recursive: true });
  for (const { name } of app.configModules) {
    const file = path.join(root, CONFIG_DIRECTORY, `${name}.toml`);
    if (existsSync(file)) {
      cpSync(file, path.join(mount, MOUNTED_CONFIG, `${name}.toml`));
    }
  }
  for (const artifact of app.artifacts) {
    cpSync(
      path.join(artifactsDirectory(root), artifact.path),
      path.join(mount, MOUNTED_ARTIFACTS, artifact.path),
      { recursive: true },
    );
  }
  const client = path.join(root, "build/client");
  const site = path.join(mount, MOUNTED_SITE);
  cpSync(client, site, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(client, source).split(path.sep).join("/");
      return (
        relative === "" ||
        (!relative.endsWith(".html") && relative !== "_headers") ||
        pages.includes(relative)
      );
    },
  });
  return mount;
}

const envLine = (name: string, value: string): string => {
  if (/[\n\r]/.test(value)) {
    throw new Error(`${name} must be a single line`);
  }
  return `${name}=${JSON.stringify(value)}`;
};

/**
 * `.chromatis/deploy`: the compose project as it lands on the server, with
 * `.env` (image, domain, database passwords) and `app.env` (the app's own
 * secrets), both mode 0600, and the mount as `instance/`.
 */
export function writeDeployBundle(
  root: string,
  app: ResolvedApplication,
  values: Readonly<Record<string, string>>,
): string {
  if (!app.image) {
    throw new Error("not an image deployment");
  }
  const bundle = path.join(root, DEPLOY_DIRECTORY);
  rmSync(bundle, { recursive: true, force: true });
  for (const file of DEPLOY_FILES) {
    const target = path.join(bundle, file);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(frameworkRoot, "infra/deploy", file), target);
  }
  cpSync(path.join(root, MOUNT_DIRECTORY), path.join(bundle, "instance"), {
    recursive: true,
  });
  const compose: Record<string, string> = {
    COMPOSE_PROJECT_NAME: app.name,
    IMAGE: `${app.image.name}:${app.image.tag}`,
    DOMAIN: new URL(app.publicUrl).hostname,
    ...(app.server.backup ? { BACKUP_TARGET: app.server.backup } : {}),
  };
  for (const name of [
    ...DATABASE_PASSWORDS,
    "DATABASE_POOL_SIZE",
    "HTTP_PORT",
    "HTTPS_PORT",
    "BACKUP_KEEP",
  ]) {
    const value = values[name] ?? process.env[name];
    if (value) {
      compose[name] = value;
    }
  }
  const own = Object.entries(values).filter(
    ([name]) => !DATABASE_PASSWORDS.includes(name),
  );
  for (const [file, entries] of [
    [".env", Object.entries(compose)],
    ["app.env", own],
  ] as const) {
    const target = path.join(bundle, file);
    writeFileSync(
      target,
      `${entries.map(([name, value]) => envLine(name, value)).join("\n")}\n`,
      { mode: 0o600 },
    );
    chmodSync(target, 0o600);
  }
  return bundle;
}

type Run = (command: string, args: string[], cwd?: string) => void;

/**
 * Copies the bundle to the server (keeping its `backups/`) and starts it there,
 * or starts it here. Tags are versions and never change, so an image already
 * present is not pulled again.
 */
export function startDeployment(
  bundle: string,
  app: ResolvedApplication,
  run: Run,
): void {
  const up =
    "docker compose pull --quiet --policy missing && docker compose up -d --remove-orphans";
  const { ssh, path: remote } = app.server;
  if (!ssh) {
    run("sh", ["-c", up], bundle);
    return;
  }
  run("ssh", [ssh, `mkdir -p ${remote}`]);
  run("rsync", [
    "-a",
    "--delete",
    "--exclude",
    "backups/",
    `${bundle}/`,
    `${ssh}:${remote}/`,
  ]);
  run("ssh", [ssh, `cd ${remote} && ${up}`]);
}

/** Waits for the deployment to answer through Caddy. */
export async function imageSmokeTest(
  app: ResolvedApplication,
  attempts = 30,
): Promise<void> {
  // Caddy serves the domain over HTTPS, whatever the app's own port.
  const url = new URL(
    `https://${new URL(app.publicUrl).hostname}/_chromatis/health`,
  );
  if (process.env.HTTPS_PORT) {
    url.port = process.env.HTTPS_PORT;
  }
  const local = url.hostname === "localhost";
  let failure = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        // Caddy's own CA signs localhost.
        ...(local ? { tls: { rejectUnauthorized: false } } : {}),
      } as RequestInit);
      if (response.ok) {
        console.info(`[deploy] smoke test passed at ${url.origin}`);
        return;
      }
      failure = `HTTP ${response.status}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Post-deploy smoke test failed for ${url}: ${failure}`);
}
