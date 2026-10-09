import { createHash } from "node:crypto";
import { parse } from "smol-toml";

export const ACCESS_OPERATIONS = [
  "select",
  "insert",
  "update",
  "delete",
] as const;
export type AccessOperation = (typeof ACCESS_OPERATIONS)[number];

export interface AccessRule {
  readonly public?: true;
  readonly role?: string;
  readonly userColumn?: string;
  readonly through?: string;
  readonly throughUserColumn?: string;
  readonly throughColumn?: string;
  readonly throughReferences?: string;
}

export interface TableAccess {
  readonly table: string;
  readonly force: boolean;
  readonly rules: Readonly<Record<AccessOperation, readonly AccessRule[]>>;
}

export interface ForeignKey {
  readonly table: string;
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
}

/** Snapshot of the database schema used to resolve and verify relationships. */
export interface SchemaCatalog {
  readonly tables: ReadonlyMap<string, ReadonlySet<string>>;
  readonly foreignKeys: readonly ForeignKey[];
  /** Role keys present in the framework `roles` table, when known. */
  readonly roles?: ReadonlySet<string>;
}

/** A foreign key a compiled policy depends on. */
export interface RequiredForeignKey {
  readonly table: string;
  readonly column: string;
  readonly referencedTable: string;
  readonly referencedColumn: string;
}

export interface CompiledPolicy {
  readonly table: string;
  readonly operation: AccessOperation;
  readonly name: string;
  readonly expression: string;
  readonly hash: string;
  readonly public: boolean;
  readonly roles: readonly string[];
  readonly requires: readonly RequiredForeignKey[];
}

export interface CompiledTable {
  readonly table: string;
  readonly force: boolean;
  readonly policies: readonly CompiledPolicy[];
}

export const POLICY_COMMENT_PREFIX = "chromatis-access:";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const ROLE_KEY = /^[a-z][a-z0-9_-]*$/;
const RULE_KEYS = [
  "public",
  "role",
  "user_column",
  "through",
  "through_user_column",
  "through_column",
  "through_references",
] as const;
const MAX_TABLE_LENGTH = 55;

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function policyName(table: string, operation: AccessOperation): string {
  return `${table}_${operation}`;
}

export function quote(identifier: string): string {
  return `"${identifier}"`;
}

export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function fail(source: string, location: string, message: string): never {
  throw new Error(`[access] ${source}: ${location}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readIdentifier(
  source: string,
  location: string,
  value: unknown,
  pattern = IDENTIFIER,
): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    return fail(
      source,
      location,
      `invalid identifier ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function parseRule(source: string, location: string, raw: unknown): AccessRule {
  if (!isRecord(raw)) {
    return fail(source, location, "a rule must be a TOML table");
  }
  for (const key of Object.keys(raw)) {
    if (!(RULE_KEYS as readonly string[]).includes(key)) {
      fail(source, location, `unknown rule key "${key}"`);
    }
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    return fail(
      source,
      location,
      "an empty rule would allow everyone; declare at least one condition",
    );
  }
  if ("public" in raw) {
    if (raw.public !== true || keys.length !== 1) {
      fail(
        source,
        location,
        "`public = true` must be the only key of an explicit public rule",
      );
    }
    return { public: true };
  }
  const rule: {
    -readonly [K in keyof AccessRule]: AccessRule[K];
  } = {};
  if ("role" in raw) {
    rule.role = readIdentifier(source, `${location}.role`, raw.role, ROLE_KEY);
  }
  if ("user_column" in raw) {
    rule.userColumn = readIdentifier(
      source,
      `${location}.user_column`,
      raw.user_column,
    );
  }
  if ("through" in raw) {
    rule.through = readIdentifier(source, `${location}.through`, raw.through);
  }
  for (const [tomlKey, field] of [
    ["through_user_column", "throughUserColumn"],
    ["through_column", "throughColumn"],
    ["through_references", "throughReferences"],
  ] as const) {
    if (tomlKey in raw) {
      if (!rule.through) {
        fail(source, location, `\`${tomlKey}\` requires \`through\``);
      }
      rule[field] = readIdentifier(
        source,
        `${location}.${tomlKey}`,
        raw[tomlKey],
      );
    }
  }
  return rule;
}

/** Parses and validates an `access.toml` document. */
export function parseAccessToml(text: string, source: string): TableAccess[] {
  let document: Record<string, unknown>;
  try {
    document = parse(text);
  } catch (error) {
    throw new Error(`[access] ${source}: invalid TOML: ${String(error)}`, {
      cause: error,
    });
  }
  for (const key of Object.keys(document)) {
    if (key !== "access") {
      fail(source, key, 'only the top-level "access" table is supported');
    }
  }
  const access = document.access ?? {};
  if (!isRecord(access)) {
    return fail(source, "access", "must be a table");
  }
  const tables: TableAccess[] = [];
  for (const [table, rawTable] of Object.entries(access)) {
    const location = `access.${table}`;
    readIdentifier(source, location, table);
    if (table.length > MAX_TABLE_LENGTH) {
      fail(
        source,
        location,
        `table name exceeds ${MAX_TABLE_LENGTH} characters`,
      );
    }
    if (!isRecord(rawTable)) {
      fail(source, location, "must be a table of operations");
    }
    let force = false;
    const rules = Object.fromEntries(
      ACCESS_OPERATIONS.map((operation) => [operation, [] as AccessRule[]]),
    ) as Record<AccessOperation, AccessRule[]>;
    for (const [key, value] of Object.entries(rawTable)) {
      if (key === "force") {
        if (typeof value !== "boolean") {
          fail(source, `${location}.force`, "must be a boolean");
        }
        force = value;
      } else if ((ACCESS_OPERATIONS as readonly string[]).includes(key)) {
        const operation = key as AccessOperation;
        if (!Array.isArray(value)) {
          fail(
            source,
            `${location}.${key}`,
            "must be an array of rules ([[...]])",
          );
        }
        rules[operation] = value.map((rule, index) =>
          parseRule(source, `${location}.${key}[${index}]`, rule),
        );
      } else {
        fail(
          source,
          location,
          `unknown key "${key}"; expected select, insert, update, delete or force`,
        );
      }
    }
    tables.push({ table, force, rules });
  }
  return tables;
}

/** Duplicate declarations of the same table across modules are not allowed. */
export function assertUniqueTables(
  declarations: ReadonlyArray<{
    source: string;
    tables: readonly TableAccess[];
  }>,
): void {
  const seen = new Map<string, string>();
  for (const { source, tables } of declarations) {
    for (const { table } of tables) {
      const previous = seen.get(table);
      if (previous) {
        throw new Error(
          `[access] table "${table}" is declared in both ${previous} and ${source}.`,
        );
      }
      seen.set(table, source);
    }
  }
}

interface ResolvedThrough {
  readonly link: string;
  readonly userColumn: string;
  readonly linkColumn: string;
  readonly references: string;
}

function resolveThrough(
  source: string,
  location: string,
  table: string,
  rule: AccessRule,
  catalog: SchemaCatalog | null,
): ResolvedThrough {
  const link = rule.through!;
  const explicitUser = rule.throughUserColumn;
  const explicitLink = rule.throughColumn;
  const explicitReferences = rule.throughReferences;

  if (explicitUser && explicitLink && !catalog) {
    return {
      link,
      userColumn: explicitUser,
      linkColumn: explicitLink,
      references: explicitReferences ?? "id",
    };
  }
  if (!catalog) {
    return fail(
      source,
      location,
      `\`through = "${link}"\` needs foreign keys from the database; apply migrations and provide a database URL, or set through_user_column and through_column explicitly`,
    );
  }
  if (!catalog.tables.has(link)) {
    fail(source, location, `link table "${link}" does not exist`);
  }
  const single = (candidate: ForeignKey): boolean =>
    candidate.columns.length === 1 && candidate.referencedColumns.length === 1;
  const userKeys = catalog.foreignKeys.filter(
    (key) =>
      key.table === link &&
      key.referencedTable === "users" &&
      single(key) &&
      (!explicitUser || key.columns[0] === explicitUser),
  );
  const targetKeys = catalog.foreignKeys.filter(
    (key) =>
      key.table === link &&
      key.referencedTable === table &&
      single(key) &&
      (!explicitLink || key.columns[0] === explicitLink) &&
      (!explicitReferences || key.referencedColumns[0] === explicitReferences),
  );
  if (userKeys.length === 0) {
    fail(
      source,
      location,
      `"${link}" has no foreign key to users(id)${explicitUser ? ` on column "${explicitUser}"` : ""}`,
    );
  }
  if (targetKeys.length === 0) {
    fail(
      source,
      location,
      `"${link}" has no foreign key to "${table}"${explicitLink ? ` on column "${explicitLink}"` : ""}`,
    );
  }
  if (userKeys.length > 1) {
    fail(
      source,
      location,
      `"${link}" has several foreign keys to users; set through_user_column`,
    );
  }
  if (targetKeys.length > 1) {
    fail(
      source,
      location,
      `"${link}" has several foreign keys to "${table}"; set through_column`,
    );
  }
  return {
    link,
    userColumn: userKeys[0]!.columns[0]!,
    linkColumn: targetKeys[0]!.columns[0]!,
    references: targetKeys[0]!.referencedColumns[0]!,
  };
}

/**
 * A `through` link table is evaluated under its own RLS inside the policy, so
 * it must let each User read their own link rows. Nothing is granted
 * implicitly: the developer must declare that rule. Returns a problem message,
 * or null when the link table is readable.
 */
export function linkTableProblem(
  protectedTable: string,
  link: string,
  userColumn: string,
  declared: readonly TableAccess[],
): string | null {
  const entry = declared.find((candidate) => candidate.table === link);
  const hint = `declare it explicitly, for example:\n  [[access.${link}.select]]\n  user_column = "${userColumn}"`;
  if (!entry) {
    return `\`through = "${link}"\` on "${protectedTable}": link table "${link}" has no access rules, so its rows are invisible to Users and the relationship can never match; ${hint}`;
  }
  const readable = entry.rules.select.some(
    (rule) =>
      rule.public ||
      (rule.userColumn === userColumn && !rule.role && !rule.through),
  );
  return readable
    ? null
    : `\`through = "${link}"\` on "${protectedTable}": the select rules of "${link}" do not let a User read their own rows (${userColumn} = current User), so the relationship can never match; ${hint}`;
}

function compileRule(
  source: string,
  location: string,
  table: string,
  rule: AccessRule,
  catalog: SchemaCatalog | null,
  declared: readonly TableAccess[],
): { sql: string; requires: RequiredForeignKey[] } {
  if (rule.public) {
    return { sql: "true", requires: [] };
  }
  const conditions: string[] = [];
  const requires: RequiredForeignKey[] = [];
  if (rule.role) {
    if (catalog?.roles && !catalog.roles.has(rule.role)) {
      fail(
        source,
        location,
        `role "${rule.role}" does not exist in the roles table`,
      );
    }
    conditions.push(`chromatis.has_role(${literal(rule.role)})`);
  }
  if (rule.userColumn) {
    if (catalog && !catalog.tables.get(table)?.has(rule.userColumn)) {
      fail(
        source,
        location,
        `column "${table}.${rule.userColumn}" does not exist`,
      );
    }
    if (
      catalog &&
      !catalog.foreignKeys.some(
        (key) =>
          key.table === table &&
          key.referencedTable === "users" &&
          key.columns.length === 1 &&
          key.columns[0] === rule.userColumn,
      )
    ) {
      fail(
        source,
        location,
        `"${table}.${rule.userColumn}" must be a foreign key to users(id)`,
      );
    }
    conditions.push(
      `${quote(table)}.${quote(rule.userColumn)} = chromatis.current_user_id()`,
    );
    requires.push({
      table,
      column: rule.userColumn,
      referencedTable: "users",
      referencedColumn: "id",
    });
  }
  if (rule.through) {
    const through = resolveThrough(source, location, table, rule, catalog);
    const problem = linkTableProblem(
      table,
      through.link,
      through.userColumn,
      declared,
    );
    if (problem) {
      fail(source, location, problem);
    }
    conditions.push(
      `EXISTS (SELECT 1 FROM ${quote(through.link)} AS "link" WHERE "link".${quote(through.userColumn)} = chromatis.current_user_id() AND "link".${quote(through.linkColumn)} = ${quote(table)}.${quote(through.references)})`,
    );
    requires.push(
      {
        table: through.link,
        column: through.userColumn,
        referencedTable: "users",
        referencedColumn: "id",
      },
      {
        table: through.link,
        column: through.linkColumn,
        referencedTable: table,
        referencedColumn: through.references,
      },
    );
  }
  return { sql: conditions.join(" AND "), requires };
}

/**
 * Compiles declared access into policies. A missing rule list yields no policy,
 * which means Deny.
 */
export function compileAccess(
  tables: readonly TableAccess[],
  source: string,
  catalog: SchemaCatalog | null,
  /** Access declared by every module, used to check `through` link tables. */
  allDeclared: readonly TableAccess[] = tables,
): CompiledTable[] {
  return tables.map((declared) => {
    if (catalog && !catalog.tables.has(declared.table)) {
      fail(source, `access.${declared.table}`, "table does not exist");
    }
    const policies: CompiledPolicy[] = [];
    for (const operation of ACCESS_OPERATIONS) {
      const rules = declared.rules[operation];
      if (rules.length === 0) {
        continue;
      }
      const compiled = rules.map((rule, index) =>
        compileRule(
          source,
          `access.${declared.table}.${operation}[${index}]`,
          declared.table,
          rule,
          catalog,
          allDeclared,
        ),
      );
      const expression =
        compiled.length === 1
          ? compiled[0]!.sql
          : compiled.map((entry) => `(${entry.sql})`).join(" OR ");
      policies.push({
        table: declared.table,
        operation,
        name: policyName(declared.table, operation),
        expression,
        hash: sha256(`${operation}\n${expression}`),
        public: rules.some((rule) => rule.public),
        roles: [
          ...new Set(rules.flatMap((rule) => (rule.role ? [rule.role] : []))),
        ],
        requires: compiled.flatMap((entry) => entry.requires),
      });
    }
    return { table: declared.table, force: declared.force, policies };
  });
}
