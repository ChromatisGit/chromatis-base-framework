import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

let healthy = true;
function report(name: string, ok: boolean, detail: string): void {
  console.info(`[doctor] ${ok ? "ok" : "error"} ${name}: ${detail}`);
  healthy &&= ok;
}

report("runtime", typeof Bun !== "undefined", `Bun ${Bun.version}`);
report("dependencies", existsSync("node_modules"), "node_modules present");
report(
  "database secret",
  Boolean(process.env.DATABASE_URL),
  "DATABASE_URL configured",
);
const git = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
report(
  "git",
  git.status === 0,
  git.status === 0 ? "repository readable" : "git unavailable",
);
process.exit(healthy ? 0 : 1);
