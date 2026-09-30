import { spawnSync } from "node:child_process";

const result = spawnSync("bun", ["x", "react-router", "dev"], {
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
