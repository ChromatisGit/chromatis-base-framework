/** Remove only this instance's Chromatis-managed local database. */
import { spawnSync } from "node:child_process";
import { devDatabaseName } from "./devDatabase";

if (process.env.CHROMATIS_DEV_DATABASE === "external") {
  throw new Error("Cannot reset an external development database.");
}
const name = devDatabaseName(process.cwd());
function docker(args: string[]): string {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Docker failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return result.stdout.trim();
}
const containers = docker(["container", "ls", "-a", "--format", "{{.Names}}"])
  .split("\n");
if (containers.includes(name)) docker(["rm", "-f", name]);
const volumes = docker(["volume", "ls", "--format", "{{.Name}}"])
  .split("\n");
if (volumes.includes(name)) docker(["volume", "rm", name]);
console.info(`[dev] Reset local database ${name}. Run bun run dev to recreate it.`);
