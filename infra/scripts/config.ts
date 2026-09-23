import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";

function findTomlFiles(): string[] {
  const files: string[] = [];
  const appConfig = path.resolve("src/app/config");
  if (existsSync(appConfig)) {
    files.push(
      ...readdirSync(appConfig)
        .filter((name) => name.endsWith(".toml"))
        .map((name) => path.join(appConfig, name)),
    );
  }
  const modules = path.resolve("src/modules");
  if (existsSync(modules)) {
    for (const moduleName of readdirSync(modules)) {
      const configFile = path.join(modules, moduleName, "config.toml");
      if (existsSync(configFile)) {
        files.push(configFile);
      }
    }
  }
  return files.sort();
}

const files = findTomlFiles();
if (files.length === 0) {
  console.info("[config] No TOML configuration files found.");
}
for (const file of files) {
  parse(readFileSync(file, "utf8"));
  console.info(`[config] valid ${path.relative(process.cwd(), file)}`);
}
