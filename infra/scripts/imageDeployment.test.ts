import { afterEach, describe, expect, test } from "bun:test";
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
import {
  deploymentSecrets,
  exportMount,
  startDeployment,
  writeDeployBundle,
} from "./imageDeployment.js";
import type { ResolvedApplication } from "./resolvedApplication.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function instance(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "chromatis-image-"));
  directories.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

const application = (
  overrides: Partial<ResolvedApplication> = {},
): ResolvedApplication =>
  ({
    name: "studyluma-org",
    publicUrl: "https://studyluma.org",
    secrets: ["DATABASE_URL", "DATABASE_AUTH_URL", "SESSION_KEY"],
    optionalSecrets: [],
    artifacts: [{ id: "catalog", owner: "catalog", path: "catalog" }],
    configModules: [
      { name: "catalog", entryFile: "/m/catalog.ts", required: true },
      { name: "classroom", entryFile: "/m/classroom.ts", required: false },
    ],
    image: { name: "ghcr.io/org/app", tag: "1.2.0" },
    server: { ssh: undefined, path: "/srv/chromatis", backup: undefined },
    ...overrides,
  }) as ResolvedApplication;

describe("image deployments", () => {
  test("need the database passwords instead of the URLs compose derives", () => {
    expect(deploymentSecrets(application())).toEqual([
      "SESSION_KEY",
      "POSTGRES_PASSWORD",
      "DATABASE_OWNER_PASSWORD",
      "DATABASE_AUTH_PASSWORD",
      "DATABASE_RUNTIME_PASSWORD",
    ]);
    expect(deploymentSecrets(application({ image: undefined }))).toEqual([
      "DATABASE_URL",
      "DATABASE_AUTH_URL",
      "SESSION_KEY",
    ]);
  });

  test("the mount holds module configuration, artifacts and the prerendered site", () => {
    const root = instance({
      "config/app.toml": "",
      "config/catalog.toml": 'courses = ["a"]\n',
      ".chromatis/artifacts/catalog/catalog.json": "{}",
      "build/client/index.html": "landing",
      "build/client/roadmap.html": "roadmap",
      "build/client/other.html": "not prerendered",
      "build/client/_headers": "",
      "build/client/assets/app-1a2b.js": "",
      "build/client/robots.txt": "",
    });
    const mount = exportMount(root, application(), [
      "index.html",
      "roadmap.html",
    ]);
    const list = (directory: string) =>
      readdirSync(path.join(mount, directory), { recursive: true })
        .map(String)
        .sort();
    expect(list("config")).toEqual(["catalog.toml"]);
    expect(list("artifacts")).toEqual(["catalog", "catalog/catalog.json"]);
    expect(list("site")).toEqual([
      "assets",
      "assets/app-1a2b.js",
      "index.html",
      "roadmap.html",
      "robots.txt",
    ]);
  });
});

describe("the deploy bundle", () => {
  test("the bundle is the compose project with private env files and the mount", () => {
    const root = instance({ ".chromatis/mount/config/catalog.toml": "" });
    const bundle = writeDeployBundle(
      root,
      application({
        server: {
          ssh: undefined,
          path: "/srv/chromatis",
          backup: "u1@u1.example:backups",
        },
      }),
      { SESSION_KEY: "k", POSTGRES_PASSWORD: "p" },
    );
    expect(readdirSync(bundle).sort()).toEqual([
      ".env",
      "Caddyfile",
      "app.env",
      "backup.sh",
      "compose.yaml",
      "instance",
      "postgres",
      "restore.sh",
    ]);
    expect(existsSync(path.join(bundle, "instance/config/catalog.toml"))).toBe(
      true,
    );
    const env = readFileSync(path.join(bundle, ".env"), "utf8");
    expect(env).toContain('IMAGE="ghcr.io/org/app:1.2.0"');
    expect(env).toContain('DOMAIN="studyluma.org"');
    expect(env).toContain('BACKUP_TARGET="u1@u1.example:backups"');
    expect(env).toContain('POSTGRES_PASSWORD="p"');
    expect(env).not.toContain("SESSION_KEY");
    expect(readFileSync(path.join(bundle, "app.env"), "utf8")).toBe(
      'SESSION_KEY="k"\n',
    );
    for (const file of [".env", "app.env"]) {
      expect(statSync(path.join(bundle, file)).mode & 0o777).toBe(0o600);
    }
  });

  test("starts here, or copies to the server and starts there", () => {
    const calls: string[] = [];
    const run = (command: string, args: string[], cwd?: string) => {
      calls.push([command, ...args, ...(cwd ? [`(in ${cwd})`] : [])].join(" "));
    };
    startDeployment("/b", application(), run);
    startDeployment(
      "/b",
      application({
        server: { ssh: "deploy@host", path: "/srv/x", backup: undefined },
      }),
      run,
    );
    const up =
      "docker compose pull --quiet --policy missing && docker compose up -d --remove-orphans";
    expect(calls).toEqual([
      `sh -c ${up} (in /b)`,
      "ssh deploy@host mkdir -p /srv/x",
      "rsync -a --delete --exclude backups/ /b/ deploy@host:/srv/x/",
      `ssh deploy@host cd /srv/x && ${up}`,
    ]);
  });
});
