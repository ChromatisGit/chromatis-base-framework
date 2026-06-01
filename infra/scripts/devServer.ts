import { spawnSync } from "node:child_process";

import { loadConfig, configToEnv } from "./config.ts";

const config = loadConfig("local");
const env = { ...process.env, ...configToEnv(config) };

const result = spawnSync("bun", ["x", "react-router", "dev"], {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 0);
