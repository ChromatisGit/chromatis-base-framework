import { spawnSync } from "node:child_process";

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, [...args], {
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("bun", ["run", "check"]);
run("bun", ["run", "doctor"]);
run("bun", ["run", "db", "apply"]);

const target = process.env.DEPLOY_TARGET;
if (target === "cloudflare") {
  run("bun", [
    "x",
    "wrangler",
    "deploy",
    "--config",
    "build/server/wrangler.json",
  ]);
} else if (target === "docker") {
  run("docker", ["compose", "up", "--build", "-d"]);
} else {
  throw new Error("DEPLOY_TARGET must be cloudflare or docker");
}
