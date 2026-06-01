import { writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { loadConfig, configToEnv } from "./config.ts";

const config = loadConfig("local");
const env = configToEnv(config);

const devVarsContent = Object.entries(env)
  .map(([k, v]) => `${k}="${v}"`)
  .join("\n") + "\n";

writeFileSync(".dev.vars", devVarsContent);
console.info("[cf:dev] Wrote .dev.vars from CONFIG.yaml local profile");

const result = spawnSync("bun", ["x", "wrangler", "dev"], {
  env: { ...process.env, WRANGLER: "1" },
  stdio: "inherit",
  shell: process.platform === "win32",
});

rmSync(".dev.vars", { force: true });
process.exit(result.status ?? 0);
