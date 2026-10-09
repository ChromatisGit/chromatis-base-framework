import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  assertUniqueTables,
  linkTableProblem,
  compileAccess,
  parseAccessToml,
  sha256,
  type AccessOperation,
  type CompiledTable,
  type RequiredForeignKey,
  type SchemaCatalog,
  type TableAccess,
} from "./access.ts";
import { renderAccessMigration } from "./accessRender.ts";
import {
  nextPatchVersion,
  normalizePath,
  slugifyDescription,
  stripSqlComments,
  writeNewMigrationFile,
} from "./dbGeneratedMigrations.ts";

const ACCESS_FILE = "access.toml";
const ACCESS_MANIFEST_PATH = "sql/access.manifest.json";
const MANIFEST_VERSION = 1;

export interface AccessManifestPolicy {
  readonly operation: AccessOperation;
  readonly name: string;
  readonly hash: string;
  readonly public: boolean;
  readonly expression: string;
  readonly roles: readonly string[];
  readonly requires: readonly RequiredForeignKey[];
}

export interface AccessManifestTable {
  readonly table: string;
  readonly force: boolean;
  readonly policies: readonly AccessManifestPolicy[];
}

export interface AccessManifest {
  readonly version: number;
  readonly sourceHash: string;
  readonly migration: string | null;
  /**
   * Every migration file this tool generated, with the SHA-256 of its exact
   * content. Hand-written RLS is forbidden everywhere else.
   */
  readonly migrations: Readonly<Record<string, string>>;
  readonly tables: readonly AccessManifestTable[];
}

export interface ModuleAccess {
  readonly name: string;
  readonly root: string;
  readonly source: string;
  readonly tables: readonly TableAccess[];
  readonly manifest: AccessManifest | null;
}

function toManifestTables(
  tables: readonly CompiledTable[],
): AccessManifestTable[] {
  return tables.map((entry) => ({
    table: entry.table,
    force: entry.force,
    policies: entry.policies.map(
      ({
        operation,
        name,
        hash,
        public: isPublic,
        expression,
        roles,
        requires,
      }) => ({
        operation,
        name,
        hash,
        public: isPublic,
        expression,
        roles,
        requires,
      }),
    ),
  }));
}

function readManifest(root: string): AccessManifest | null {
  const file = path.join(root, ACCESS_MANIFEST_PATH);
  if (!existsSync(file)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as AccessManifest;
  if (parsed.version !== MANIFEST_VERSION) {
    throw new Error(
      `[access] Unsupported access manifest version ${parsed.version}; expected ${MANIFEST_VERSION}.`,
    );
  }
  return parsed;
}

export function loadModuleAccess(root: string): ModuleAccess | null {
  const file = path.join(root, ACCESS_FILE);
  const manifest = readManifest(root);
  const name = path.basename(root);
  if (!existsSync(file)) {
    return manifest ? { name, root, source: "", tables: [], manifest } : null;
  }
  const source = readFileSync(file, "utf8");
  const tables = parseAccessToml(
    source,
    normalizePath(path.join(name, ACCESS_FILE)),
  );
  return { name, root, source, tables, manifest };
}

export function loadApplicationAccess(applicationRoot: string): ModuleAccess[] {
  const modulesDirectory = path.join(applicationRoot, "src/modules");
  if (!existsSync(modulesDirectory)) {
    return [];
  }
  const modules = readdirSync(modulesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const loaded = loadModuleAccess(path.join(modulesDirectory, entry.name));
      return loaded ? [loaded] : [];
    });
  assertUniqueTables(
    modules.map((module) => ({
      source: `${module.name}/${ACCESS_FILE}`,
      tables: module.tables,
    })),
  );
  return modules;
}

/**
 * Generates the RLS migration for one module. Pass a catalog so `through`
 * relationships can be derived from foreign keys and verified.
 */
export function generateAccessMigration(
  description: string,
  root: string,
  catalog: SchemaCatalog | null,
  /** Access declared by all modules; defaults to this module only. */
  allDeclared?: readonly TableAccess[],
): string | null {
  const module = loadModuleAccess(root);
  if (!module) {
    return null;
  }
  const slug = slugifyDescription(description);
  if (!slug) {
    throw new Error("[access] Migration description is required.");
  }
  const sourceHash = sha256(module.source);
  if (module.manifest?.sourceHash === sourceHash) {
    console.info(`[access] ${module.name}: access rules are already in sync.`);
    return null;
  }
  const compiled = compileAccess(
    module.tables,
    `${module.name}/${ACCESS_FILE}`,
    catalog,
    allDeclared,
  );
  const declared = new Set(compiled.map((entry) => entry.table));
  const removed = (module.manifest?.tables ?? [])
    .map((entry) => entry.table)
    .filter((table) => !declared.has(table));
  const sql = renderAccessMigration(compiled, removed);

  const filename = `${nextPatchVersion(root)}__${slug}.sql`;
  mkdirSync(path.join(root, "migrations"), { recursive: true });
  writeNewMigrationFile(path.join(root, "migrations", filename), sql);

  const manifest: AccessManifest = {
    version: MANIFEST_VERSION,
    sourceHash,
    migration: filename,
    migrations: { ...module.manifest?.migrations, [filename]: sha256(sql) },
    tables: toManifestTables(compiled),
  };
  mkdirSync(path.join(root, "sql"), { recursive: true });
  writeFileSync(
    path.join(root, ACCESS_MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.info(`[access] Wrote migrations/${filename}`);
  console.info(`[access] Updated ${ACCESS_MANIFEST_PATH}`);
  return filename;
}

/** Offline drift check: access.toml must match its generated artifacts. */
export function checkAccessDrift(module: ModuleAccess): string[] {
  const problems: string[] = [];
  const label = `${module.name}/${ACCESS_FILE}`;
  const { manifest } = module;
  if (!manifest) {
    if (module.tables.length > 0) {
      problems.push(
        `${label} has no generated RLS migration. Run \`bun run db generate ${module.name} <description>\`.`,
      );
    }
    return problems;
  }
  if (manifest.sourceHash !== sha256(module.source)) {
    problems.push(
      `${label} changed without regenerated RLS. Run \`bun run db generate ${module.name} <description>\` and commit the migration + manifest.`,
    );
  }
  for (const [filename, hash] of Object.entries(manifest.migrations)) {
    const file = path.join(module.root, "migrations", filename);
    if (!existsSync(file)) {
      problems.push(
        `${module.name}: generated access migration ${filename} is missing.`,
      );
    } else if (sha256(readFileSync(file, "utf8")) !== hash) {
      problems.push(
        `${module.name}: generated access migration ${filename} was edited; regenerate instead of editing it.`,
      );
    }
  }
  return problems;
}

/** `through` link tables must be readable by their Users under their own rules. */
export function checkLinkTables(
  module: ModuleAccess,
  allDeclared: readonly TableAccess[],
): string[] {
  const problems = new Set<string>();
  for (const table of module.manifest?.tables ?? []) {
    for (const policy of table.policies) {
      for (const key of policy.requires) {
        if (key.table !== table.table && key.referencedTable === "users") {
          const problem = linkTableProblem(
            table.table,
            key.table,
            key.column,
            allDeclared,
          );
          if (problem) {
            problems.add(`${module.name}/${ACCESS_FILE}: ${problem}`);
          }
        }
      }
    }
  }
  return [...problems];
}

const FORBIDDEN_HANDWRITTEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bCREATE\s+POLICY\b/i, "CREATE POLICY"],
  [/\bALTER\s+POLICY\b/i, "ALTER POLICY"],
  [/\bDROP\s+POLICY\b/i, "DROP POLICY"],
  [
    /\b(?:ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/i,
    "row-level-security toggles",
  ],
  [/\bBYPASSRLS\b/i, "BYPASSRLS"],
  [/\bSECURITY\s+DEFINER\b/i, "SECURITY DEFINER"],
  [/\bset_config\s*\(/i, "set_config()"],
  [
    /\b(?:SET|RESET)\s+(?:LOCAL\s+|SESSION\s+)?(?:ROLE|SESSION\s+AUTHORIZATION)\b/i,
    "SET/RESET ROLE or SESSION AUTHORIZATION",
  ],
  [/\bMATERIALIZED\s+VIEW\b/i, "MATERIALIZED VIEW (bypasses RLS)"],
];

const VIEW_PATTERN =
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:RECURSIVE\s+)?VIEW\b[\s\S]*?;/gi;
const SECURITY_INVOKER = /\bsecurity_invoker\s*(?:=\s*)?(?:true|on|1)\b/i;

/** Invariants for SQL that is not generated from access.toml. */
export function checkSqlInvariants(sql: string, label: string): string[] {
  const text = stripSqlComments(sql);
  const problems: string[] = [];
  for (const [pattern, name] of FORBIDDEN_HANDWRITTEN) {
    if (pattern.test(text)) {
      problems.push(`${label}: ${name} is not allowed here.`);
    }
  }
  for (const match of text.matchAll(VIEW_PATTERN)) {
    if (!SECURITY_INVOKER.test(match[0])) {
      problems.push(
        `${label}: views must be created WITH (security_invoker = true).`,
      );
    }
  }
  return problems;
}

/** Routine sources only: SECURITY DEFINER and materialized views are rejected. */
export function checkRoutineSources(root: string): string[] {
  const problems: string[] = [];
  for (const directory of ["sql/views", "sql/functions"]) {
    const full = path.join(root, directory);
    if (!existsSync(full)) {
      continue;
    }
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(path.join(dir, entry.name))
          : entry.name.endsWith(".sql")
            ? [path.join(dir, entry.name)]
            : [],
      );
    for (const file of walk(full)) {
      const label = normalizePath(
        path.join(path.basename(root), path.relative(root, file)),
      );
      const sql = readFileSync(file, "utf8");
      problems.push(...checkSqlInvariants(sql, label));
      if (
        directory === "sql/views" &&
        !/\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/i.test(stripSqlComments(sql))
      ) {
        problems.push(`${label}: a view source must contain CREATE VIEW.`);
      }
    }
  }
  return problems;
}

/** Hand-written migrations must not contain security objects. */
export function checkHandwrittenMigrations(
  root: string,
  generated: ReadonlySet<string>,
): string[] {
  const directory = path.join(root, "migrations");
  if (!existsSync(directory)) {
    return [];
  }
  const routineMigrations = new Set<string>();
  const routineManifest = path.join(root, "sql/routines.manifest.json");
  if (existsSync(routineManifest)) {
    const parsed = JSON.parse(readFileSync(routineManifest, "utf8")) as {
      migration?: string | null;
    };
    if (parsed.migration) {
      routineMigrations.add(parsed.migration);
    }
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql") && !generated.has(name))
    .flatMap((name) => {
      const label = normalizePath(
        path.join(path.basename(root), "migrations", name),
      );
      const sql = readFileSync(path.join(directory, name), "utf8");
      // Routine migrations are generated from sql/views + sql/functions and
      // checked at the source; a migration may still contain neither policies
      // nor SECURITY DEFINER, so the same rules apply.
      return checkSqlInvariants(sql, label);
    });
}

export interface SecurityCheckResult {
  readonly modules: readonly ModuleAccess[];
  readonly problems: readonly string[];
}

/** Everything `bun run check` verifies without a database. */
export function checkApplicationSecurity(
  applicationRoot = process.cwd(),
): SecurityCheckResult {
  const problems: string[] = [];
  let modules: ModuleAccess[] = [];
  try {
    modules = loadApplicationAccess(applicationRoot);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
    return { modules, problems };
  }
  const modulesDirectory = path.join(applicationRoot, "src/modules");
  const roots = existsSync(modulesDirectory)
    ? readdirSync(modulesDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(modulesDirectory, entry.name))
    : [];
  const allDeclared = modules.flatMap((module) => module.tables);
  for (const module of modules) {
    problems.push(...checkAccessDrift(module));
    problems.push(...checkLinkTables(module, allDeclared));
  }
  for (const root of roots) {
    const module = modules.find((candidate) => candidate.root === root);
    problems.push(...checkRoutineSources(root));
    problems.push(
      ...checkHandwrittenMigrations(
        root,
        new Set(Object.keys(module?.manifest?.migrations ?? {})),
      ),
    );
  }
  return { modules, problems };
}
