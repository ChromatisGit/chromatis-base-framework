/**
 * Chromatis module declarations.
 *
 * A product package declares each of its modules with `defineModule` in a
 * `module.ts` file and generates a manifest (`createManifest`) that Chromatis
 * discovers in an instance. This file is declaration-only: it validates data
 * and performs no I/O, so it can be imported from any runtime or build script.
 */
import { z } from "zod";
import { ValidationError } from "./errors.js";
import {
  routeDeclarationSchema,
  type RouteDeclaration,
} from "./route-declaration.js";
import {
  isZodSchema,
  lenientObjectPaths,
  objectSchemaKeys,
} from "./schema-introspection.js";

export type { RouteDeclaration } from "./route-declaration.js";
export { lenientObjectPaths } from "./schema-introspection.js";

const moduleName = z.string().regex(/^[a-z][a-z0-9-]*$/, {
  message:
    "must be lowercase letters, digits and hyphens, starting with a letter",
});
const runtimeKind = moduleName;
const identifier = z.string().regex(/^[A-Za-z_$][\w$]*$/, {
  message: "must be a JavaScript identifier",
});
const secretName = z.string().regex(/^[A-Z][A-Z0-9_]*$/, {
  message: "must be UPPER_SNAKE_CASE",
});
const specifier = z.string().min(1).regex(/^\S+$/, {
  message: "must be an importable specifier without spaces",
});
const relativePath = z.string().refine(isSafeRelativePath, {
  message: "must be a relative path without '.', '..' or empty segments",
});

/** Names owned by Chromatis; modules cannot declare them. */
const RESERVED_MODULE_NAMES: readonly string[] = ["app"];
const RESERVED_SECRET_NAMES: readonly string[] = [
  "DATABASE_URL",
  "DATABASE_MIGRATION_URL",
  "DATABASE_AUTH_URL",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
];

export function isSafeRelativePath(value: string): boolean {
  if (value === "" || value.startsWith("/") || value.includes("\\")) {
    return false;
  }
  if (/^[A-Za-z]:/.test(value)) {
    return false;
  }
  return value
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

const zodType = z.custom<z.ZodTypeAny>(isZodSchema, {
  message: "must be a zod schema",
});

const secretSchema = z
  .object({
    name: secretName,
    description: z.string().min(1),
    required: z.enum(["always", "production"]),
  })
  .strict();

const contributionSchema = z
  .object({
    id: moduleName,
    module: specifier,
    export: identifier.default("default"),
  })
  .strict();

const authoredFilesSchema = z
  .object({ module: specifier, export: identifier.default("default") })
  .strict();

const artifactSchema = z
  .object({
    id: moduleName,
    path: relativePath,
    validator: z
      .object({ module: specifier, export: identifier.default("default") })
      .strict()
      .optional(),
  })
  .strict();

function unique(
  context: z.RefinementCtx,
  path: (string | number)[],
  values: readonly string[],
  what: string,
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: `duplicate ${what} "${value}"`,
      });
    }
    seen.add(value);
  }
}

const declarationSchema = z
  .object({
    name: moduleName,
    config: z
      .object({ schema: zodType, required: z.boolean().default(false) })
      .strict()
      .superRefine((config, context) => {
        for (const path of lenientObjectPaths(config.schema)) {
          context.addIssue({
            code: "custom",
            path: ["schema"],
            message: `object schema at ${path} must be .strict() so unknown keys are rejected`,
          });
        }
      })
      .optional(),
    secrets: z.array(secretSchema).default([]),
    runtime: z.array(runtimeKind).default([]),
    serverHook: relativePath.optional(),
    database: z.boolean().default(false),
    contributions: z.array(contributionSchema).default([]),
    artifacts: z.array(artifactSchema).default([]),
    authoredFiles: z.array(authoredFilesSchema).default([]),
    routes: z.array(routeDeclarationSchema).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (RESERVED_MODULE_NAMES.includes(value.name)) {
      context.addIssue({
        code: "custom",
        path: ["name"],
        message: `"${value.name}" is reserved by Chromatis`,
      });
    }
    if (value.runtime.length > 0 && !value.serverHook) {
      context.addIssue({
        code: "custom",
        path: ["serverHook"],
        message: "serverHook is required when runtime kinds are declared",
      });
    }
    unique(context, ["runtime"], value.runtime, "runtime kind");
    unique(
      context,
      ["secrets"],
      value.secrets.map((s) => s.name),
      "secret",
    );
    unique(
      context,
      ["contributions"],
      value.contributions.map((c) => c.id),
      "contribution id",
    );
    unique(
      context,
      ["artifacts"],
      value.artifacts.map((a) => a.id),
      "artifact id",
    );
    for (const [index, secret] of value.secrets.entries()) {
      if (RESERVED_SECRET_NAMES.includes(secret.name)) {
        context.addIssue({
          code: "custom",
          path: ["secrets", index, "name"],
          message: `${secret.name} is reserved by Chromatis`,
        });
      }
    }
  });

export type ModuleSecret = Readonly<{
  name: string;
  description: string;
  required: "always" | "production";
}>;

export type ModuleContribution = Readonly<{
  id: string;
  /** Importable specifier of the contribution module. */
  module: string;
  /** Defaults to "default". */
  export?: string;
}>;

/**
 * Code that tells Chromatis which files an author writes by hand and which
 * schema each one follows, so editors can complete and validate them. The
 * export is a function `(context: AuthoredFilesContext) => AuthoredFileSchema[]`
 * (it may be async). Chromatis only knows that files matching a glob follow a
 * schema; the module owns the paths and the schemas.
 */
export type ModuleAuthoredFiles = Readonly<{
  /** Importable specifier of the module that exports the function. */
  module: string;
  /** Defaults to "default". */
  export?: string;
}>;

/** The argument Chromatis passes to an authored-files function. */
export type AuthoredFilesContext = Readonly<{
  instanceRoot: string;
  environment: string;
  /** Validated module configuration keyed by module name. */
  config: Readonly<Record<string, unknown>>;
}>;

/** Files matching `include` are written following `schema`. */
export type AuthoredFileSchema = Readonly<{
  /** Names the schema ("course"); unique within the module. */
  name: string;
  /** Instance-relative globs. The first association matching a file wins. */
  include: string | readonly string[];
  schema: z.ZodTypeAny;
}>;

export type ModuleArtifact = Readonly<{
  id: string;
  /** Relative to `.chromatis/artifacts/`. */
  path: string;
  validator?: Readonly<{ module: string; export?: string }>;
}>;

export type ModuleDeclarationInput<Schema extends z.ZodTypeAny = z.ZodTypeAny> =
  Readonly<{
    /** Equals the module directory name. */
    name: string;
    /** File `config/<name>.toml`, validated against `schema` (use `.strict()`). */
    config?: Readonly<{ schema: Schema; required?: boolean }>;
    secrets?: readonly ModuleSecret[];
    /** Stateful Runtime kinds. */
    runtime?: readonly string[];
    /** Module-relative path of the server hook file. */
    serverHook?: string;
    /** Uses PostgreSQL. */
    database?: boolean;
    contributions?: readonly ModuleContribution[];
    artifacts?: readonly ModuleArtifact[];
    /** Authored files the module's content follows (see ModuleAuthoredFiles). */
    authoredFiles?: readonly ModuleAuthoredFiles[];
    /** Routes this module adds to the application (see RouteDeclaration). */
    routes?: readonly RouteDeclaration[];
  }>;

/** The validated, normalized declaration (defaults applied, frozen). */
export type ModuleDeclaration<Schema extends z.ZodTypeAny = z.ZodTypeAny> =
  Readonly<{
    name: string;
    config?: Readonly<{ schema: Schema; required: boolean }>;
    secrets: readonly ModuleSecret[];
    runtime: readonly string[];
    serverHook?: string;
    database: boolean;
    contributions: readonly Readonly<{
      id: string;
      module: string;
      export: string;
    }>[];
    artifacts: readonly Readonly<{
      id: string;
      path: string;
      validator?: Readonly<{ module: string; export: string }>;
    }>[];
    authoredFiles: readonly Readonly<{ module: string; export: string }>[];
    routes: readonly RouteDeclaration[];
  }>;

export type ModuleDeclarationResult =
  | Readonly<{ ok: true; declaration: ModuleDeclaration }>
  | Readonly<{
      ok: false;
      issues: readonly { path: string; message: string }[];
    }>;

function freezeDeclaration(value: z.output<typeof declarationSchema>) {
  const { config, ...rest } = value;
  return Object.freeze({
    ...rest,
    ...(config ? { config: Object.freeze({ ...config }) } : {}),
    secrets: Object.freeze(value.secrets.map((item) => Object.freeze(item))),
    runtime: Object.freeze([...value.runtime]),
    contributions: Object.freeze(
      value.contributions.map((item) => Object.freeze(item)),
    ),
    authoredFiles: Object.freeze(
      value.authoredFiles.map((item) => Object.freeze(item)),
    ),
    artifacts: Object.freeze(
      value.artifacts.map((item) =>
        Object.freeze({
          ...item,
          ...(item.validator
            ? { validator: Object.freeze(item.validator) }
            : {}),
        }),
      ),
    ),
  }) as ModuleDeclaration;
}

/** Validates unknown data (for example a loaded module's default export). */
export function parseModuleDeclaration(
  value: unknown,
): ModuleDeclarationResult {
  const result = declarationSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  return { ok: true, declaration: freezeDeclaration(result.data) };
}

/**
 * Declares a Chromatis module. Default-export the result from the module's
 * `module.ts`. Throws a `ValidationError` naming every invalid field.
 */
export function defineModule<Schema extends z.ZodTypeAny = z.ZodTypeAny>(
  input: ModuleDeclarationInput<Schema>,
): ModuleDeclaration<Schema> {
  const result = parseModuleDeclaration(input);
  if (result.ok) {
    return result.declaration as ModuleDeclaration<Schema>;
  }
  const name =
    typeof (input as { name?: unknown }).name === "string"
      ? (input as { name: string }).name
      : "?";
  const details: Record<string, string[]> = {};
  for (const issue of result.issues) {
    (details[issue.path || "declaration"] ??= []).push(issue.message);
  }
  throw new ValidationError(`Invalid module declaration "${name}"`, details);
}

/**
 * The validated configuration of a module at runtime. `all` is the `config`
 * export of the generated `chromatis-config` module; the value was validated
 * against the module's schema when the instance was built, so it is not
 * parsed again.
 */
export function moduleConfig<Schema extends z.ZodTypeAny>(
  declaration: ModuleDeclaration<Schema>,
  all: Readonly<Record<string, unknown>>,
): z.output<Schema> {
  if (!declaration.config) {
    throw new Error(`Module ${declaration.name} declares no config`);
  }
  const value = all[declaration.name];
  if (value === undefined) {
    throw new Error(
      `No configuration for module ${declaration.name}; was the instance built with chromatis build?`,
    );
  }
  return value as z.output<Schema>;
}

// --- Manifest -------------------------------------------------------------

export const MANIFEST_FORMAT_VERSION = 1;

const manifestModuleSchema = z
  .object({
    name: moduleName,
    /** Importable specifier of the module's `module.ts`. */
    entry: specifier,
    config: z
      .object({ required: z.boolean(), keys: z.array(z.string()) })
      .strict()
      .optional(),
    secrets: z.array(secretSchema),
    runtime: z.array(runtimeKind),
    serverHook: relativePath.optional(),
    database: z.boolean(),
    contributions: z.array(
      contributionSchema.extend({ export: identifier }).strict(),
    ),
    routes: z.array(routeDeclarationSchema).default([]),
    authoredFiles: z
      .array(authoredFilesSchema.extend({ export: identifier }).strict())
      .optional(),
    artifacts: z.array(
      artifactSchema
        .extend({
          validator: z
            .object({ module: specifier, export: identifier })
            .strict()
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();

/** Application-level parts of the product package, outside any module. */
const manifestAppSchema = z
  .object({
    /** The React Router root route file (specifier, see RouteDeclaration). */
    root: z.string().regex(/^\S+$/).optional(),
    routes: z.array(routeDeclarationSchema).default([]),
  })
  .strict();

export type ManifestApp = z.output<typeof manifestAppSchema>;

export const manifestSchema = z
  .object({
    formatVersion: z.literal(MANIFEST_FORMAT_VERSION),
    app: manifestAppSchema.optional(),
    modules: z.array(manifestModuleSchema),
  })
  .strict()
  .superRefine((value, context) => {
    for (let index = 1; index < value.modules.length; index++) {
      const previous = value.modules[index - 1]?.name ?? "";
      const current = value.modules[index]?.name ?? "";
      if (current <= previous) {
        context.addIssue({
          code: "custom",
          path: ["modules", index, "name"],
          message: `modules must be unique and sorted by name ("${current}" after "${previous}")`,
        });
      }
    }
  });

/** One module as listed in the manifest: inspectable without executing code. */
export type ManifestModule = z.output<typeof manifestModuleSchema>;
export type ChromatisManifest = z.output<typeof manifestSchema>;

const byText =
  <T>(select: (item: T) => string) =>
  (a: T, b: T) =>
    select(a) < select(b) ? -1 : select(a) > select(b) ? 1 : 0;

/** Canonical plain-JSON summary of a declaration (every list sorted). */
export function summarizeModule(
  declaration: ModuleDeclaration,
  entry: string,
): ManifestModule {
  return {
    name: declaration.name,
    entry,
    ...(declaration.config
      ? {
          config: {
            required: declaration.config.required,
            keys: objectSchemaKeys(declaration.config.schema),
          },
        }
      : {}),
    secrets: declaration.secrets
      .map((secret) => ({ ...secret }))
      .sort(byText((secret) => secret.name)),
    runtime: [...declaration.runtime].sort(),
    ...(declaration.serverHook ? { serverHook: declaration.serverHook } : {}),
    database: declaration.database,
    contributions: declaration.contributions
      .map((contribution) => ({ ...contribution }))
      .sort(byText((contribution) => contribution.id)),
    artifacts: declaration.artifacts
      .map((artifact) => ({
        id: artifact.id,
        path: artifact.path,
        ...(artifact.validator ? { validator: { ...artifact.validator } } : {}),
      }))
      .sort(byText((artifact) => artifact.id)),
    ...(declaration.authoredFiles.length > 0
      ? {
          authoredFiles: declaration.authoredFiles
            .map((item) => ({ ...item }))
            .sort(byText((item) => `${item.module}#${item.export}`)),
        }
      : {}),
    routes: [...declaration.routes],
  };
}

/** Builds the deterministic manifest for a package's modules. */
export function createManifest(
  modules: readonly Readonly<{
    entry: string;
    declaration: ModuleDeclaration;
  }>[],
  app?: Readonly<{ root?: string; routes?: readonly RouteDeclaration[] }>,
): ChromatisManifest {
  const manifest = {
    formatVersion: MANIFEST_FORMAT_VERSION,
    ...(app ? { app } : {}),
    modules: modules
      .map(({ entry, declaration }) => summarizeModule(declaration, entry))
      .sort(byText((module) => module.name)),
  };
  return manifestSchema.parse(manifest);
}

/** Stable text for writing `chromatis.manifest.json`. */
export function serializeManifest(manifest: ChromatisManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export { z };
