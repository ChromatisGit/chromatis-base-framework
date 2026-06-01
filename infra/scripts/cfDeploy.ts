import { spawnSync } from "node:child_process";

import { loadConfig, configToEnv } from "./config.ts";

function run(cmd: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }): void {
  const result = spawnSync(cmd, args, {
    env: opts?.env ?? process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runWithInput(cmd: string, args: string[], input: string): void {
  const result = spawnSync(cmd, args, {
    input,
    stdio: ["pipe", "inherit", "inherit"],
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const config = loadConfig("production");
const env = configToEnv(config);

// 1. Build the Cloudflare Workers bundle
console.info("[cf:deploy] Building Cloudflare Workers bundle...");
run("bun", ["x", "react-router", "build"], { env: { ...process.env, WRANGLER: "1" } });

// 2. Deploy first — this clears any stale var bindings on Cloudflare before we set secrets.
//    If a name was previously a [vars] entry and is now a secret, deploying first removes
//    the var binding so the subsequent secret put does not conflict (code 10053).
console.info("\n[cf:deploy] Deploying to Cloudflare Workers...");
run("bun", ["x", "wrangler", "deploy", "--config", "build/server/wrangler.json"]);

// 3. Sync all production config values to Cloudflare as secrets
console.info("\n[cf:deploy] Syncing secrets to Cloudflare Workers...");
for (const [key, value] of Object.entries(env)) {
  if (!value) {
    console.warn(`  [!] ${key} is empty in CONFIG.yaml production profile — skipping`);
    continue;
  }
  console.info(`  Setting ${key}...`);
  runWithInput("bun", ["x", "wrangler", "secret", "put", key], value + "\n");
}

console.info("\n[cf:deploy] Done.");
