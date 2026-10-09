import type postgres from "postgres";
import {
  POLICY_COMMENT_PREFIX,
  type ForeignKey,
  type SchemaCatalog,
} from "./access.ts";
import type { AccessManifestTable, ModuleAccess } from "./accessMigrations.ts";
import { policyStatement } from "./accessRender.ts";
import {
  DATABASE_AUTH_ROLE,
  DATABASE_RUNTIME_ROLE,
} from "../../src/db/setup.ts";
import type { SetupQueryExecutor } from "../../src/db/setup.ts";

/** Framework-owned tables are protected by column grants, not access.toml. */
export const FRAMEWORK_TABLES: ReadonlySet<string> = new Set([
  "users",
  "roles",
  "user_roles",
  "auth_sessions",
  "external_identities",
  "oidc_authorization_attempts",
  "chromatis_schema_migrations",
]);

/**
 * The only SECURITY DEFINER function. Privileged framework operations do not
 * use definer functions at all: they run as the separate chromatis_auth
 * principal, which application SQL cannot reach.
 */
export const AUDITED_DEFINER_FUNCTIONS: ReadonlySet<string> = new Set([
  "chromatis.has_role",
]);

/** Sensitive framework state the runtime role may not touch directly. */
const SENSITIVE_FRAMEWORK_TABLES: readonly string[] = [
  "users",
  "roles",
  "user_roles",
  "auth_sessions",
  "external_identities",
  "oidc_authorization_attempts",
];

export function makeExecutor(
  sql: postgres.Sql | postgres.TransactionSql,
): SetupQueryExecutor {
  return async (statement, values = []) =>
    (await sql.unsafe(
      statement,
      values as postgres.ParameterOrJSON<never>[],
    )) as Array<Record<string, unknown>>;
}

export async function loadSchemaCatalog(
  query: SetupQueryExecutor,
): Promise<SchemaCatalog> {
  const columnRows = await query(`
    SELECT c.relname::text AS table_name,
           array_agg(a.attname::text ORDER BY a.attnum) AS columns
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    GROUP BY c.relname
  `);
  const keyRows = await query(`
    SELECT t.relname::text AS table_name,
           rt.relname::text AS referenced_table,
           (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns,
           (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS referenced_columns
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
    JOIN pg_class rt ON rt.oid = c.confrelid
    JOIN pg_namespace rn ON rn.oid = rt.relnamespace
    WHERE c.contype = 'f' AND tn.nspname = 'public' AND rn.nspname = 'public'
  `);
  const roles = await query("SELECT key FROM roles").then(
    (rows) => new Set(rows.map((row) => String(row.key))),
    () => undefined,
  );
  return {
    ...(roles ? { roles } : {}),
    tables: new Map(
      columnRows.map((row) => [
        String(row.table_name),
        new Set(row.columns as string[]),
      ]),
    ),
    foreignKeys: keyRows.map(
      (row): ForeignKey => ({
        table: String(row.table_name),
        columns: row.columns as string[],
        referencedTable: String(row.referenced_table),
        referencedColumns: row.referenced_columns as string[],
      }),
    ),
  };
}

type Rows = Array<Record<string, unknown>>;

async function auditFrameworkState(
  query: SetupQueryExecutor,
): Promise<string[]> {
  const rows = await query(
    `SELECT c.relname::text AS name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ANY ($1::text[])
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $2)
       AND (has_table_privilege($2, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
            OR has_any_column_privilege($2, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))`,
    [SENSITIVE_FRAMEWORK_TABLES, DATABASE_RUNTIME_ROLE],
  );
  return rows.map(
    (row) =>
      `${DATABASE_RUNTIME_ROLE} has direct privileges on framework table ${String(row.name)}; use the framework functions`,
  );
}

/** The auth principal may touch framework tables only. */
async function auditAuthScope(query: SetupQueryExecutor): Promise<string[]> {
  const rows = await query(
    `SELECT c.relname::text AS name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
       AND c.relname <> ALL ($1::text[])
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $2)
       AND has_any_column_privilege($2, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')`,
    [[...FRAMEWORK_TABLES], DATABASE_AUTH_ROLE],
  );
  return rows.map(
    (row) =>
      `${DATABASE_AUTH_ROLE} has privileges on application relation ${String(row.name)}`,
  );
}

async function auditRole(
  query: SetupQueryExecutor,
  roleName: string,
  label: string,
): Promise<string[]> {
  const roles = await query(
    `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
            EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner = r.oid
                    AND c.relkind IN ('r','p','v','m')
                    AND c.relnamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)) AS owns_objects
     FROM pg_roles r WHERE rolname = $1`,
    [roleName],
  );
  const role = roles[0];
  const name = `${label} ${roleName}`;
  if (!role) {
    return [`${name} does not exist`];
  }
  const checks: Array<[unknown, string]> = [
    [role.rolsuper, "is a superuser"],
    [role.rolbypassrls, "has BYPASSRLS"],
    [role.rolcreatedb || role.rolcreaterole, "can create databases or roles"],
    [role.owns_objects, "owns tables or views"],
  ];
  return checks
    .filter(([bad]) => bad)
    .map(([, message]) => `${name} ${message}`);
}

function declaredTables(
  modules: readonly ModuleAccess[],
): Map<string, AccessManifestTable> {
  return new Map(
    modules.flatMap((module) =>
      (module.manifest?.tables ?? []).map(
        (table) => [table.table, table] as const,
      ),
    ),
  );
}

function auditUndeclaredTables(
  tables: Rows,
  declared: ReadonlyMap<string, AccessManifestTable>,
): string[] {
  const problems: string[] = [];
  for (const row of tables) {
    const name = String(row.name);
    if (
      FRAMEWORK_TABLES.has(name) ||
      declared.has(name) ||
      !row.runtime_access
    ) {
      continue;
    }
    problems.push(
      `table ${name} is accessible to ${DATABASE_RUNTIME_ROLE} but has no access.toml declaration`,
    );
    if (!row.rls) {
      problems.push(`table ${name} does not have row-level security enabled`);
    }
  }
  return problems;
}

function auditDeclaredTable(
  table: AccessManifestTable,
  row: Record<string, unknown> | undefined,
  policies: Rows,
): string[] {
  const name = table.table;
  if (!row) {
    return [`declared table ${name} does not exist`];
  }
  const problems: string[] = [];
  if (!row.rls) {
    problems.push(`table ${name}: RLS is not enabled`);
  }
  if (Boolean(row.forced) !== table.force) {
    problems.push(
      `table ${name}: FORCE RLS is ${row.forced ? "on" : "off"} but access.toml requires ${table.force ? "on" : "off"}`,
    );
  }
  const live = policies.filter((policy) => policy.table_name === name);
  for (const expected of table.policies) {
    const match = live.find((policy) => policy.name === expected.name);
    if (!match) {
      problems.push(`table ${name}: policy ${expected.name} is missing`);
    } else if (match.comment !== `${POLICY_COMMENT_PREFIX}${expected.hash}`) {
      problems.push(
        `table ${name}: policy ${expected.name} differs from the generated definition`,
      );
    }
  }
  for (const policy of live) {
    if (!table.policies.some((expected) => expected.name === policy.name)) {
      problems.push(`table ${name}: unexpected policy ${String(policy.name)}`);
    }
  }
  return problems;
}

async function auditTables(
  query: SetupQueryExecutor,
  modules: readonly ModuleAccess[],
  probe: Probe | null,
): Promise<string[]> {
  const tables = await query(`
    SELECT c.relname::text AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           CASE WHEN r.rolname IS NULL THEN false ELSE
             (has_table_privilege(r.rolname, c.oid, 'SELECT')
              OR has_table_privilege(r.rolname, c.oid, 'INSERT')
              OR has_table_privilege(r.rolname, c.oid, 'UPDATE')
              OR has_table_privilege(r.rolname, c.oid, 'DELETE')) END AS runtime_access
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_roles r ON r.rolname = '${DATABASE_RUNTIME_ROLE}'
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  `);
  const policies = await query(`
    SELECT c.relname::text AS table_name, p.polname::text AS name, d.description AS comment,
           p.polcmd::text AS command, p.polpermissive AS permissive,
           (p.polroles = '{0}'::oid[]) AS for_public,
           pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_description d ON d.objoid = p.oid AND d.classoid = 'pg_policy'::regclass
    WHERE n.nspname = 'public'
  `);
  const declared = declaredTables(modules);
  const present = new Map(tables.map((row) => [String(row.name), row]));
  const problems = auditUndeclaredTables(tables, declared);
  for (const table of declared.values()) {
    problems.push(
      ...auditDeclaredTable(table, present.get(table.table), policies),
    );
  }
  for (const policy of policies) {
    const name = String(policy.table_name);
    if (!declared.has(name) && !FRAMEWORK_TABLES.has(name)) {
      problems.push(
        `table ${name}: policy ${String(policy.name)} is not declared`,
      );
    }
  }
  problems.push(...(await auditPolicyDefinitions(modules, policies, probe)));
  return problems;
}

async function auditRequiredForeignKeys(
  query: SetupQueryExecutor,
  modules: readonly ModuleAccess[],
): Promise<string[]> {
  const catalog = await loadSchemaCatalog(query);
  const problems: string[] = [];
  for (const table of declaredTables(modules).values()) {
    for (const policy of table.policies) {
      for (const key of policy.requires) {
        const exists = catalog.foreignKeys.some(
          (fk) =>
            fk.table === key.table &&
            fk.columns.length === 1 &&
            fk.columns[0] === key.column &&
            fk.referencedTable === key.referencedTable &&
            fk.referencedColumns[0] === key.referencedColumn,
        );
        if (!exists) {
          problems.push(
            `policy ${policy.name}: required foreign key ${key.table}.${key.column} -> ${key.referencedTable}.${key.referencedColumn} is missing`,
          );
        }
      }
    }
  }
  return problems;
}

async function auditViewsAndFunctions(
  query: SetupQueryExecutor,
): Promise<string[]> {
  const problems: string[] = [];
  const relations = await query(`
    SELECT c.relname::text AS name, c.relkind::text AS kind, c.reloptions AS options
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  `);
  for (const relation of relations) {
    const name = String(relation.name);
    const options = (relation.options as string[] | null) ?? [];
    if (relation.kind === "m") {
      problems.push(`materialized view ${name} bypasses RLS`);
    } else if (
      !options.some((option) => /^security_invoker=(true|on)$/.test(option))
    ) {
      problems.push(`view ${name} is not security_invoker`);
    }
  }
  const functions = await query(`
    SELECT n.nspname::text AS schema_name, p.proname::text AS name,
           (p.proconfig IS NOT NULL AND 'search_path=pg_catalog, pg_temp' = ANY (p.proconfig)) AS fixed_search_path,
           EXISTS (
             SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
           ) AS public_execute,
           (SELECT coalesce(array_agg(r.rolname::text), '{}')
            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            JOIN pg_roles r ON r.oid = a.grantee
            WHERE a.privilege_type = 'EXECUTE' AND r.oid <> p.proowner) AS grantees
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  `);
  for (const fn of functions) {
    const name = `${String(fn.schema_name)}.${String(fn.name)}`;
    if (!AUDITED_DEFINER_FUNCTIONS.has(name)) {
      problems.push(`function ${name} is SECURITY DEFINER`);
      continue;
    }
    if (!fn.fixed_search_path) {
      problems.push(
        `function ${name} must set search_path = pg_catalog, pg_temp`,
      );
    }
    if (fn.public_execute) {
      problems.push(`function ${name} is executable by PUBLIC`);
    }
    const extra = (fn.grantees as string[]).filter(
      (grantee) => grantee !== DATABASE_RUNTIME_ROLE,
    );
    if (extra.length > 0) {
      problems.push(`function ${name} is executable by ${extra.join(", ")}`);
    }
  }
  return problems;
}

/**
 * Runs `fn` on a privileged (owner) connection inside a transaction that is
 * always rolled back. Used to let PostgreSQL itself normalise expected policies.
 */
export type Probe = <T>(
  fn: (query: SetupQueryExecutor) => Promise<T>,
) => Promise<T>;

const COMMAND_CODES: Record<string, string> = {
  select: "r",
  insert: "a",
  update: "w",
  delete: "d",
};

async function auditPolicyDefinitions(
  modules: readonly ModuleAccess[],
  livePolicies: Rows,
  probe: Probe | null,
): Promise<string[]> {
  const declared = declaredTables(modules);
  if (declared.size === 0) {
    return [];
  }
  if (!probe) {
    return [
      "cannot verify policy definitions and role references without DATABASE_MIGRATION_URL",
    ];
  }
  return probe(async (query) => {
    const problems: string[] = [];
    const roleKeys = new Set(
      (await query("SELECT key FROM roles")).map((row) => String(row.key)),
    );
    for (const table of declared.values()) {
      for (const policy of table.policies) {
        for (const role of policy.roles) {
          if (!roleKeys.has(role)) {
            problems.push(
              `policy ${policy.name}: role "${role}" does not exist in the roles table`,
            );
          }
        }
        const live = livePolicies.find(
          (row) => row.table_name === table.table && row.name === policy.name,
        );
        if (!live) {
          continue;
        }
        await query(
          policyStatement({
            ...policy,
            table: table.table,
            name: "chromatis_probe",
          }),
        );
        const [expected] = await query(
          `SELECT pg_get_expr(polqual, polrelid) AS qual,
                  pg_get_expr(polwithcheck, polrelid) AS check_expr
           FROM pg_policy WHERE polname = 'chromatis_probe' AND polrelid = $1::regclass`,
          [`public.${table.table}`],
        );
        await query(`DROP POLICY chromatis_probe ON "${table.table}"`);
        const matches =
          live.command === COMMAND_CODES[policy.operation] &&
          live.permissive === true &&
          live.for_public === true &&
          live.qual === (expected?.qual ?? null) &&
          live.check_expr === (expected?.check_expr ?? null);
        if (!matches) {
          problems.push(
            `table ${table.table}: policy ${policy.name} does not match its declared definition`,
          );
        }
      }
    }
    return problems;
  });
}

/**
 * Verifies the live database against the generated access manifests and the
 * Chromatis security invariants. Returns one message per violation.
 */
export async function auditDatabase(
  query: SetupQueryExecutor,
  modules: readonly ModuleAccess[],
  probe: Probe | null = null,
): Promise<string[]> {
  return [
    ...(await auditRole(query, DATABASE_RUNTIME_ROLE, "runtime role")),
    ...(await auditRole(query, DATABASE_AUTH_ROLE, "auth role")),
    ...(await auditAuthScope(query)),
    ...(await auditFrameworkState(query)),
    ...(await auditTables(query, modules, probe)),
    ...(await auditRequiredForeignKeys(query, modules)),
    ...(await auditViewsAndFunctions(query)),
  ];
}

class Rollback extends Error {}

/** Builds a rolled-back-transaction probe over a privileged connection. */
export function makeProbe(sql: postgres.Sql): Probe {
  return async <T>(fn: (query: SetupQueryExecutor) => Promise<T>) => {
    let result: T | undefined;
    try {
      await sql.begin(async (tx) => {
        result = await fn(makeExecutor(tx));
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) {
        throw error;
      }
    }
    return result as T;
  };
}
