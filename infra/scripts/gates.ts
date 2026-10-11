import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Problem } from "./problems.js";

/** Gates run by `check`, in order; the `check` script itself never. */
export const CHECK_SCRIPTS = ["typecheck", "lint", "format:check", "test"];
/** Set while those scripts run, so a script that calls `chromatis check` cannot recurse. */
export const CHECK_ACTIVE = "CHROMATIS_CHECK_ACTIVE";

/** The installed executable `name`, from the nearest `node_modules/.bin`. */
export function findBin(root: string, name: string): string | undefined {
  for (let directory = root; ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, "node_modules/.bin", name);
    if (existsSync(candidate)) {
      return candidate;
    }
    if (path.dirname(directory) === directory) {
      return undefined;
    }
  }
}

function packageScripts(root: string): Record<string, string> {
  return (
    (
      JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      }
    ).scripts ?? {}
  );
}

/**
 * The files Prettier checks and `fix` formats: the paths of the instance's own
 * `prettier … --check` script, else `app`, `src`, `server` and `package.json`.
 */
export function formatTargets(root: string): string[] {
  const script = packageScripts(root)["format:check"];
  const declared = script?.match(/^prettier\s+(.+?)\s+--check\s*$/)?.[1];
  const targets = declared
    ? declared.split(/\s+/).filter((token) => !token.startsWith("-"))
    : ["app", "src", "server", "package.json"];
  return targets.filter((entry) => existsSync(path.join(root, entry)));
}

/**
 * What `check` runs for a gate the instance does not script itself. A command
 * whose tool is not installed is skipped. `test` has no default.
 */
function defaultCommands(root: string, name: string): string[][] {
  const commands: Record<string, string[][]> = {
    typecheck: [
      ["react-router", "typegen"],
      ["tsc", "--noEmit"],
    ],
    lint: [["eslint", ".", "--max-warnings", "0"]],
    "format:check": [["prettier", ...formatTargets(root), "--check"]],
  };
  return (commands[name] ?? []).flatMap(([tool, ...args]) => {
    const bin = tool ? findBin(root, tool) : undefined;
    return bin ? [[bin, ...args]] : [];
  });
}

function runGate(root: string, name: string, defined: boolean): Problem[] {
  const commands = defined
    ? [["bun", "run", name]]
    : defaultCommands(root, name);
  for (const [command, ...args] of commands) {
    const result = spawnSync(command ?? "", args, {
      cwd: root,
      env: { ...process.env, [CHECK_ACTIVE]: "1" },
      encoding: "utf8",
    });
    if (result.status !== 0) {
      const output = `${result.stdout}${result.stderr}`.trim().split("\n");
      return [
        {
          source: `${defined ? "script" : "check"} ${name}`,
          message: `failed (exit ${result.status ?? "signal"})\n${output
            .slice(-15)
            .map((line) => `    ${line}`)
            .join("\n")}`,
        },
      ];
    }
  }
  return [];
}

/**
 * Runs typecheck, lint, format and test: the instance's own script of that
 * name when it defines one, otherwise Chromatis' default (see defaultCommands).
 */
export function runGates(root: string): Problem[] {
  const defined = packageScripts(root);
  return CHECK_SCRIPTS.flatMap((name) =>
    runGate(root, name, defined[name] !== undefined),
  );
}
