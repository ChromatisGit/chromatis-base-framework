import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { CONFIG_ENVIRONMENTS, z } from "../../src/config.js";
import {
  isSafeRelativePath,
  type AuthoredFilesContext,
} from "../../src/module.js";
import {
  isZodSchema,
  toInputJsonSchema,
  type JsonSchema,
} from "../../src/schema-introspection.js";
import { loadFunction } from "./artifacts.js";
import { buildPlan, type BuildPlan } from "./buildPlan.js";
import { loadInstance, type Instance } from "./instance.js";
import type { Problem } from "./problems.js";

/**
 * Editor support for TOML the author writes by hand. The Zod schemas stay the
 * validation authority; this module only derives JSON Schema from them so an
 * editor (Taplo, "Even Better TOML") can complete and flag keys.
 *
 * Everything is generated under `.chromatis/schemas/`. Taplo discovers
 * configuration only in the workspace root, so the association is a
 * `#:schema` line at the top of each file, which `chromatis fix` maintains and
 * `chromatis check` verifies.
 */

export const SCHEMAS_DIRECTORY = ".chromatis/schemas";
const SCHEMA_SUFFIX = ".schema.json";

const isRecord = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mapValues = (
  value: unknown,
  change: (node: JsonSchema) => JsonSchema,
): unknown =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          isRecord(child) ? change(child) : child,
        ]),
      )
    : value;

/**
 * Every table of a configuration layer may leave any value to another layer,
 * so nothing in it is required. Only tables are merged across layers (see
 * `mergeTables` in `src/config.ts`): object properties and record values.
 * Arrays are replaced as a whole, so the items of a list keep their required
 * keys.
 */
function overlay(node: JsonSchema): JsonSchema {
  const result: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "required") {
      continue;
    }
    if (key === "properties" || key === "patternProperties") {
      result[key] = mapValues(value, overlay);
    } else if (key === "additionalProperties" && isRecord(value)) {
      result[key] = overlay(value);
    } else if (key === "anyOf" || key === "allOf" || key === "oneOf") {
      // Overlapping alternatives would fail `oneOf` once their keys are optional.
      const target = key === "oneOf" && !("anyOf" in node) ? "anyOf" : key;
      result[target] = Array.isArray(value)
        ? value.map((option) => (isRecord(option) ? overlay(option) : option))
        : value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

const LAYER_DESCRIPTIONS: Readonly<Record<string, string>> = {
  default: "Applies in every environment; an environment table overrides it.",
  local: "Applies only in the local environment, on top of [default].",
  test: "Applies only in the test environment, on top of [default].",
  production:
    "Applies only in the production environment, on top of [default].",
};

/**
 * The JSON Schema of a `config/<owner>.toml` file. A file holds values at the
 * top level, in `[default]` and in one table per environment; Chromatis merges
 * them (tables recursively, everything else replaced) before the Zod schema
 * validates the result. Each layer is therefore a partial overlay of the
 * schema, and required values are checked after merging (`chromatis check`).
 */
export function layeredConfigSchema(
  schema: z.ZodType,
  title: string,
): JsonSchema {
  const input = toInputJsonSchema(schema, { cycles: "throw" });
  if (!isRecord(input.properties)) {
    throw new Error("a configuration schema must be an object schema");
  }
  const reserved = ["default", ...CONFIG_ENVIRONMENTS].filter(
    (name) => name in (input.properties as JsonSchema),
  );
  if (reserved.length > 0) {
    throw new Error(
      `the keys ${reserved.map((name) => `"${name}"`).join(", ")} are reserved for the environment tables`,
    );
  }
  const { $schema, ...layer } = overlay(input);
  const layers = Object.fromEntries(
    ["default", ...CONFIG_ENVIRONMENTS].map((name) => [
      name,
      {
        $ref: "#/definitions/layer",
        description: LAYER_DESCRIPTIONS[name] ?? "",
      },
    ]),
  );
  return {
    ...(typeof $schema === "string" ? { $schema } : {}),
    title,
    type: "object",
    properties: { ...(layer.properties as JsonSchema), ...layers },
    ...("additionalProperties" in layer
      ? { additionalProperties: layer.additionalProperties }
      : {}),
    definitions: { layer },
  };
}

/** The JSON Schema of an authored file, which has no layers. */
export function authoredFileJsonSchema(
  schema: z.ZodType,
  title: string,
): JsonSchema {
  const { $schema, ...rest } = toInputJsonSchema(schema, { cycles: "throw" });
  return {
    ...(typeof $schema === "string" ? { $schema } : {}),
    title,
    ...rest,
  };
}

// --- Plan ------------------------------------------------------------------

export type EditorSchema = Readonly<{
  /** File name inside `.chromatis/schemas/`. */
  file: string;
  json: JsonSchema;
}>;

export type EditorAssociation = Readonly<{
  /** The TOML file, relative to the instance root, with forward slashes. */
  file: string;
  /** The `file` of the schema it follows. */
  schema: string;
}>;

export type EditorPlan = Readonly<{
  schemas: readonly EditorSchema[];
  associations: readonly EditorAssociation[];
  problems: readonly Problem[];
}>;

const associationSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, {
    message: "must be lowercase letters, digits and hyphens",
  }),
  include: z
    .union([z.string(), z.array(z.string())])
    .refine((value) => [value].flat().length > 0, {
      message: "must name at least one glob",
    })
    .refine(
      (value) =>
        [value].flat().every((glob) => glob !== "" && isSafeRelativePath(glob)),
      {
        message:
          "globs must be relative to the instance, without '.', '..' or empty segments",
      },
    ),
  schema: z.custom<z.ZodType>(isZodSchema, { message: "must be a zod schema" }),
});

type Association = z.output<typeof associationSchema>;

function scanGlob(root: string, pattern: string): string[] {
  return [...new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: true })]
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => !file.split("/").includes("node_modules"))
    .sort();
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const byFile = <T extends { file: string }>(a: T, b: T): number =>
  a.file < b.file ? -1 : 1;

/** Collects schemas, the file each follows and what could not be derived. */
function planBuilder() {
  const schemas: EditorSchema[] = [];
  const problems: Problem[] = [];
  const claimed = new Map<string, EditorAssociation & { owner: string }>();
  return {
    problems,
    /** Adds a schema; false (and a problem) when it cannot be converted. */
    addSchema(file: string, source: string, build: () => JsonSchema): boolean {
      try {
        schemas.push({ file, json: build() });
        return true;
      } catch (error) {
        problems.push({
          source,
          message: `no editor schema: ${message(error)}`,
        });
        return false;
      }
    },
    claim(file: string, schema: string, owner: string, source: string): void {
      const existing = claimed.get(file);
      if (!existing) {
        claimed.set(file, { file, schema, owner });
      } else if (existing.owner !== owner || existing.schema !== schema) {
        problems.push({
          source,
          key: file,
          message: `already follows ${existing.schema} (${existing.owner}); one file cannot follow two schemas`,
        });
      }
    },
    /** The first association of a module that matches a file wins. */
    isClaimedBy: (file: string, owner: string): boolean =>
      claimed.get(file)?.owner === owner,
    finish: (): EditorPlan => ({
      schemas: schemas.sort(byFile),
      associations: [...claimed.values()]
        .map(({ file, schema }) => ({ file, schema }))
        .sort(byFile),
      problems,
    }),
  };
}

type PlanBuilder = ReturnType<typeof planBuilder>;
type AuthoredProvider = BuildPlan["authoredFiles"][number];

/** Runs a module's authored-files function and validates what it returns. */
async function runProvider(
  instance: Instance,
  build: BuildPlan,
  provider: AuthoredProvider,
): Promise<Association[]> {
  const provide = (await loadFunction(provider.code)) as (
    context: AuthoredFilesContext,
  ) => unknown;
  const parsed = z.array(associationSchema).safeParse(
    await provide({
      instanceRoot: instance.root,
      environment: instance.environment,
      config: build.moduleConfigs,
    }),
  );
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "result"}: ${issue.message}`)
        .join("; "),
    );
  }
  return parsed.data;
}

async function planProvider(
  plan: PlanBuilder,
  instance: Instance,
  build: BuildPlan,
  provider: AuthoredProvider,
): Promise<void> {
  const source = `${provider.owner} authored files`;
  const config = instance.modules.find(
    ({ module }) => module.name === provider.owner,
  )?.config;
  if (config && config.effective === undefined) {
    return; // The module's own configuration problems are reported already.
  }
  let associations: Association[];
  try {
    associations = await runProvider(instance, build, provider);
  } catch (error) {
    plan.problems.push({
      source,
      key: provider.code.specifier,
      message: `failed: ${message(error)}`,
    });
    return;
  }
  const names = new Set<string>();
  for (const association of associations) {
    if (names.has(association.name)) {
      plan.problems.push({
        source,
        key: association.name,
        message: "duplicate association name",
      });
      continue;
    }
    names.add(association.name);
    const file = `${provider.owner}.${association.name}${SCHEMA_SUFFIX}`;
    const title = `${provider.owner}: ${association.name}`;
    if (
      !plan.addSchema(file, source, () =>
        authoredFileJsonSchema(association.schema, title),
      )
    ) {
      continue;
    }
    for (const glob of [association.include].flat()) {
      for (const match of scanGlob(instance.root, glob)) {
        if (
          match.endsWith(".toml") &&
          !plan.isClaimedBy(match, provider.owner)
        ) {
          plan.claim(match, file, provider.owner, source);
        }
      }
    }
  }
}

/**
 * The schemas and file associations of an instance, derived from the same
 * configuration slots `loadInstance` validates (`app` and every active
 * module's config) plus the authored files the modules declare. Never throws;
 * what cannot be derived is reported in `problems`.
 */
export async function planEditorSchemas(
  instance: Instance,
): Promise<EditorPlan> {
  const plan = planBuilder();
  const slots = [
    instance.app,
    ...instance.modules.flatMap(({ config }) => (config ? [config] : [])),
  ];
  for (const { slot, present, file } of slots) {
    const name = `${slot.owner}${SCHEMA_SUFFIX}`;
    const added = plan.addSchema(name, file, () =>
      layeredConfigSchema(slot.schema, file),
    );
    if (added && present) {
      plan.claim(file, name, slot.owner, file);
    }
  }
  const build = buildPlan(instance);
  for (const provider of build.authoredFiles) {
    await planProvider(plan, instance, build, provider);
  }
  return plan.finish();
}

// --- Files -----------------------------------------------------------------

const schemaText = (schema: EditorSchema): string =>
  `${JSON.stringify(schema.json, null, 2)}\n`;

export const schemaPath = (root: string, file: string): string =>
  path.join(root, SCHEMAS_DIRECTORY, file);

/** Writes the schemas and removes the ones no slot or association needs. */
export function writeEditorSchemas(root: string, plan: EditorPlan): void {
  const directory = path.join(root, SCHEMAS_DIRECTORY);
  mkdirSync(directory, { recursive: true });
  const wanted = new Set(plan.schemas.map((schema) => schema.file));
  for (const name of readdirSync(directory)) {
    if (name.endsWith(SCHEMA_SUFFIX) && !wanted.has(name)) {
      rmSync(path.join(directory, name));
    }
  }
  for (const schema of plan.schemas) {
    const file = path.join(directory, schema.file);
    const text = schemaText(schema);
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
      writeFileSync(file, text);
    }
  }
}

/** The line that makes an editor apply the schema, relative to the TOML file. */
export function directiveFor(file: string, schema: string): string {
  const relative = path.posix.relative(
    path.posix.dirname(file),
    `${SCHEMAS_DIRECTORY}/${schema}`,
  );
  return `#:schema ${/^\.\.?\//.test(relative) ? relative : `./${relative}`}`;
}

const DIRECTIVE = /^#:schema[ \t]+\S+[ \t]*$/;

/** Leading comment or blank lines, where Taplo reads its `#:schema` directive. */
function directiveIndex(lines: readonly string[]): number {
  for (const [index, line] of lines.entries()) {
    if (DIRECTIVE.test(line)) {
      return index;
    }
    if (line.trim() !== "" && !line.startsWith("#")) {
      return -1;
    }
  }
  return -1;
}

export function readDirective(text: string): string | undefined {
  const lines = text.split("\n");
  const index = directiveIndex(lines);
  return index < 0 ? undefined : lines[index]?.trim();
}

/** The text with exactly this directive: replaced in place, or added first. */
export function withDirective(text: string, directive: string): string {
  const lines = text.split("\n");
  const index = directiveIndex(lines);
  if (index >= 0) {
    lines[index] = directive;
    return lines.join("\n");
  }
  return `${directive}\n${text}`;
}

/** Adds or corrects the directive of every associated file; returns those changed. */
export function applyDirectives(root: string, plan: EditorPlan): string[] {
  const changed: string[] = [];
  for (const { file, schema } of plan.associations) {
    const target = path.join(root, file);
    const text = readFileSync(target, "utf8");
    const updated = withDirective(text, directiveFor(file, schema));
    if (updated !== text) {
      writeFileSync(target, updated);
      changed.push(file);
    }
  }
  return changed;
}

/** Findings for `chromatis check`: schemas out of date, directives missing. */
export function editorSchemaProblems(
  root: string,
  plan: EditorPlan,
): Problem[] {
  const problems: Problem[] = [...plan.problems];
  for (const schema of plan.schemas) {
    const file = schemaPath(root, schema.file);
    if (
      !existsSync(file) ||
      readFileSync(file, "utf8") !== schemaText(schema)
    ) {
      problems.push({
        source: `${SCHEMAS_DIRECTORY}/${schema.file}`,
        message: "differs from the framework output; run chromatis init",
      });
    }
  }
  for (const { file, schema } of plan.associations) {
    const expected = directiveFor(file, schema);
    const found = readDirective(readFileSync(path.join(root, file), "utf8"));
    if (found !== expected) {
      problems.push({
        source: file,
        message: found
          ? `editor schema line is "${found}", expected "${expected}"; run chromatis fix`
          : `missing the editor schema line "${expected}"; run chromatis fix`,
      });
    }
  }
  return problems;
}

/**
 * Writes the instance's schemas and returns the plan. Needs no valid
 * configuration: what cannot be derived is a problem in the plan, not an error.
 */
export async function syncEditorSchemas(root: string): Promise<EditorPlan> {
  const plan = await planEditorSchemas(await loadInstance(root, "local"));
  writeEditorSchemas(root, plan);
  return plan;
}
