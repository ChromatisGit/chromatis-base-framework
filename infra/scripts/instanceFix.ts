import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  applyDirectives,
  planEditorSchemas,
  writeEditorSchemas,
} from "./editorSchemas.js";
import { checkInstance } from "./instanceCheck.js";
import { findBin, formatTargets } from "./gates.js";
import { CONFIG_DIRECTORY, defaultConfigText } from "./instanceConfig.js";
import { loadInstance } from "./instance.js";
import type { Problem } from "./problems.js";

export type FixResult = Readonly<{
  created: readonly string[];
  /** TOML files that gained or corrected their editor schema line. */
  annotated: readonly string[];
  /** The files formatted, or undefined when Prettier is not installed. */
  formatted: readonly string[] | undefined;
  remaining: readonly Problem[];
}>;

/** Formats exactly the files the format gate checks; undefined without Prettier. */
export function formatWithPrettier(root: string): string[] | undefined {
  const bin = findBin(root, "prettier");
  const targets = formatTargets(root);
  if (!bin) {
    return undefined;
  }
  const result = spawnSync(bin, ["--write", ...targets], {
    cwd: root,
    stdio: "ignore",
  });
  return result.status === 0 ? targets : undefined;
}

/**
 * The only mutations `fix` makes: missing config files whose every value has a
 * schema default, the editor schema line of hand-written TOML files, and
 * formatting. It never decides target, domain, content or
 * credentials; whatever is still wrong is returned in `remaining`.
 */
export async function fixInstance(
  root: string,
  format: (root: string) => string[] | undefined = formatWithPrettier,
): Promise<FixResult> {
  const created: string[] = [];
  const instance = await loadInstance(root, "local");
  for (const { config } of instance.modules) {
    const text =
      config?.slot.required && !config.present && config.creatableFromDefaults
        ? defaultConfigText(config.slot)
        : undefined;
    if (config && text !== undefined) {
      mkdirSync(path.join(root, CONFIG_DIRECTORY), { recursive: true });
      writeFileSync(path.join(root, config.file), text, { flag: "wx" });
      created.push(config.file);
    }
  }
  const plan = await planEditorSchemas(await loadInstance(root, "local"));
  writeEditorSchemas(root, plan);
  const annotated = applyDirectives(root, plan);
  return {
    created,
    annotated,
    formatted: format(root),
    remaining: await checkInstance(root, { scripts: false }),
  };
}
