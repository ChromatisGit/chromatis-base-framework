import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const MANIFEST_VERSION = 1;
const ROUTINE_MANIFEST_PATH = "sql/routines.manifest.json";

type RoutineKind = "view" | "function";

interface RoutineObject {
  kind: RoutineKind;
  name: string;
  signature?: string;
}

interface RoutineSourceFile {
  kind: RoutineKind;
  path: string;
  hash: string;
  objects: RoutineObject[];
  sql: string;
}

interface RoutineManifestFile {
  kind: RoutineKind;
  path: string;
  hash: string;
  objects: RoutineObject[];
}

interface RoutineManifest {
  version: number;
  combinedHash: string;
  migration: string | null;
  files: RoutineManifestFile[];
}

interface RoutineState {
  combinedHash: string;
  files: RoutineSourceFile[];
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function readSqlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true })
    .map((entry) => ({
      entry,
      fullPath: path.join(dir, entry.name),
    }))
    .sort((a, b) => a.entry.name.localeCompare(b.entry.name));

  return entries.flatMap(({ entry, fullPath }) => {
    if (entry.isDirectory()) return readSqlFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith(".sql")) return [fullPath];
    return [];
  });
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    const next = input[i + 1];

    if (quote) {
      current += ch;
      if (ch === quote && next === quote) {
        current += next;
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === "\"") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);

    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function normalizeFunctionArg(arg: string): string | null {
  const withoutDefault = arg
    .replace(/\s+DEFAULT\s+[\s\S]*$/i, "")
    .replace(/\s+=\s+[\s\S]*$/i, "")
    .trim();

  if (!withoutDefault) return null;

  const tokens = withoutDefault.split(/\s+/).filter(Boolean);
  const mode = tokens[0]?.toUpperCase();

  if (mode === "OUT") return null;
  if (mode === "IN" || mode === "INOUT" || mode === "VARIADIC") {
    tokens.shift();
  }

  if (tokens.length === 0) return null;
  if (tokens.length === 1) return tokens[0]!;

  return tokens.slice(1).join(" ");
}

function getFunctionSignature(name: string, args: string): string {
  const argTypes = splitTopLevel(args)
    .map(normalizeFunctionArg)
    .filter((arg): arg is string => Boolean(arg));
  return `${name}(${argTypes.join(", ")})`;
}

function extractRoutineObjects(kind: RoutineKind, sql: string): RoutineObject[] {
  const withoutComments = stripSqlComments(sql);
  const objects: RoutineObject[] = [];

  if (kind === "view") {
    const viewRe = /\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+((?:"[^"]+"|[a-z_][\w$]*)(?:\.(?:"[^"]+"|[a-z_][\w$]*))?)/gi;
    for (const match of withoutComments.matchAll(viewRe)) {
      const name = match[1]?.trim();
      if (name) objects.push({ kind, name });
    }
    return objects;
  }

  const functionRe = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"[^"]+"|[a-z_][\w$]*)(?:\.(?:"[^"]+"|[a-z_][\w$]*))?)\s*\(([\s\S]*?)\)/gi;
  for (const match of withoutComments.matchAll(functionRe)) {
    const name = match[1]?.trim();
    const args = match[2] ?? "";
    if (name) objects.push({ kind, name, signature: getFunctionSignature(name, args) });
  }

  return objects;
}

function loadRoutineState(rootDir = process.cwd()): RoutineState {
  const routineDirs: Array<{ kind: RoutineKind; dir: string }> = [
    { kind: "view", dir: path.join(rootDir, "sql/views") },
    { kind: "function", dir: path.join(rootDir, "sql/functions") },
  ];

  const files = routineDirs.flatMap(({ kind, dir }) =>
    readSqlFiles(dir).map((filePath) => {
      const sql = readFileSync(filePath, "utf8");
      const relativePath = normalizePath(path.relative(rootDir, filePath));
      return {
        kind,
        path: relativePath,
        hash: sha256(sql),
        objects: extractRoutineObjects(kind, sql),
        sql,
      };
    }),
  );

  const combinedHash = sha256(
    files
      .map((file) => `${file.kind}:${file.path}:${file.hash}`)
      .join("\n"),
  );

  return { combinedHash, files };
}

function manifestPath(rootDir = process.cwd()): string {
  return path.join(rootDir, ROUTINE_MANIFEST_PATH);
}

function loadRoutineManifest(rootDir = process.cwd()): RoutineManifest | null {
  const filePath = manifestPath(rootDir);
  if (!existsSync(filePath)) return null;

  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as RoutineManifest;
  if (parsed.version !== MANIFEST_VERSION) {
    throw new Error(
      `[db] Unsupported routine manifest version ${parsed.version}; expected ${MANIFEST_VERSION}.`,
    );
  }
  return parsed;
}

function toManifest(
  state: RoutineState,
  migration: string | null,
): RoutineManifest {
  return {
    version: MANIFEST_VERSION,
    combinedHash: state.combinedHash,
    migration,
    files: state.files.map(({ kind, path: filePath, hash, objects }) => ({
      kind,
      path: filePath,
      hash,
      objects,
    })),
  };
}

function writeRoutineManifest(
  state: RoutineState,
  migration: string | null,
  rootDir = process.cwd(),
): void {
  const filePath = manifestPath(rootDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify(toManifest(state, migration), null, 2)}\n`,
    "utf8",
  );
}

function formatObjectDrop(object: RoutineObject): string {
  if (object.kind === "function") {
    return `DROP FUNCTION IF EXISTS ${object.signature ?? `${object.name}()`};`;
  }
  return `DROP VIEW IF EXISTS ${object.name};`;
}

function getChangedFiles(
  state: RoutineState,
  manifest: RoutineManifest | null,
): {
  addedOrChanged: RoutineSourceFile[];
  removed: RoutineManifestFile[];
  previousByPath: Map<string, RoutineManifestFile>;
} {
  const previousByPath = new Map(
    (manifest?.files ?? []).map((file) => [file.path, file]),
  );
  const currentByPath = new Map(state.files.map((file) => [file.path, file]));

  return {
    addedOrChanged: state.files.filter((file) => previousByPath.get(file.path)?.hash !== file.hash),
    removed: [...previousByPath.values()].filter((file) => !currentByPath.has(file.path)),
    previousByPath,
  };
}

function buildRoutineMigrationSql(
  state: RoutineState,
  manifest: RoutineManifest | null,
): string {
  const { addedOrChanged, removed, previousByPath } = getChangedFiles(state, manifest);
  const changedPreviousObjects = addedOrChanged.flatMap(
    (file) => previousByPath.get(file.path)?.objects ?? [],
  );
  const removedObjects = removed.flatMap((file) => file.objects);
  const objectsToDrop = [...changedPreviousObjects, ...removedObjects];

  const functionDrops = objectsToDrop
    .filter((object) => object.kind === "function")
    .map(formatObjectDrop);
  const viewDrops = objectsToDrop
    .filter((object) => object.kind === "view")
    .map(formatObjectDrop);

  const sections = [
    "-- Generated by @chromatis/base. Edit sql/views/*.sql and sql/functions/*.sql, then regenerate.",
  ];

  if (functionDrops.length > 0 || viewDrops.length > 0) {
    sections.push(
      ["-- Drop changed or removed routines", ...functionDrops, ...viewDrops].join("\n"),
    );
  }

  const changedViews = addedOrChanged.filter((file) => file.kind === "view");
  const changedFunctions = addedOrChanged.filter((file) => file.kind === "function");

  for (const file of [...changedViews, ...changedFunctions]) {
    sections.push(`-- ${file.path}\n${file.sql.trim()}`);
  }

  return `${sections.join("\n\n")}\n`;
}

function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`[db] Invalid migration version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function nextPatchVersion(rootDir = process.cwd()): string {
  const migrationsDir = path.join(rootDir, "sql/migrations");
  const latest = existsSync(migrationsDir)
    ? readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => /^(\d+\.\d+\.\d+)__[a-z0-9][a-z0-9_-]*\.sql$/i.exec(entry.name)?.[1])
      .filter((version): version is string => Boolean(version))
      .sort((a, b) => a.localeCompare(b))
      .at(-1)
    : undefined;
  const [major, minor, patch] = parseVersion(latest ?? "0.0.0");
  return `${major}.${minor}.${patch + 1}`;
}

function slugifyDescription(description: string): string {
  return description
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function checkGeneratedMigrationState(rootDir = process.cwd()): void {
  const state = loadRoutineState(rootDir);
  if (state.files.length === 0) return;

  const manifest = loadRoutineManifest(rootDir);
  if (!manifest) {
    throw new Error(
      "[db] SQL routine sources are not tracked. Run `bun run db:generate <description>` and commit the generated migration + manifest.",
    );
  }

  if (manifest.combinedHash !== state.combinedHash) {
    const { addedOrChanged, removed } = getChangedFiles(state, manifest);
    const changed = addedOrChanged.map((file) => `  changed: ${file.path}`);
    const deleted = removed.map((file) => `  removed: ${file.path}`);
    throw new Error(
      [
        "[db] SQL routine sources changed without a generated migration.",
        ...changed,
        ...deleted,
        "Run `bun run db:generate <description>` and commit the generated migration + manifest.",
      ].join("\n"),
    );
  }
}

export function generateRoutineMigration(
  description: string,
  rootDir = process.cwd(),
): string | null {
  const slug = slugifyDescription(description);
  if (!slug) {
    throw new Error("[db] Migration description is required.");
  }

  const state = loadRoutineState(rootDir);
  const manifest = loadRoutineManifest(rootDir);

  if (state.files.length === 0) {
    console.info("[db] No SQL routine sources found.");
    return null;
  }

  if (manifest?.combinedHash === state.combinedHash) {
    console.info("[db] SQL routine sources are already in sync.");
    return null;
  }

  const version = nextPatchVersion(rootDir);
  const filename = `${version}__${slug}.sql`;
  const migrationPath = path.join(rootDir, "sql/migrations", filename);
  const sql = buildRoutineMigrationSql(state, manifest);

  mkdirSync(path.dirname(migrationPath), { recursive: true });
  writeFileSync(migrationPath, sql, "utf8");
  writeRoutineManifest(state, filename, rootDir);

  console.info(`[db] Wrote ${normalizePath(path.relative(rootDir, migrationPath))}`);
  console.info(`[db] Updated ${ROUTINE_MANIFEST_PATH}`);
  return filename;
}
