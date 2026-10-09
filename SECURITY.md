# Chromatis security

Chromatis enforces persistent-User access in PostgreSQL. Application code never
holds a raw connection, and a missing rule always means **deny**.

## Principles

- **Default Deny** – no matching allow rule, no access. There is no default allow.
- **Least Privilege** – the runtime role has only the grants a module declares.
- **Complete Mediation** – every query goes through `userSQL` / `publicSQL` (or the
  transaction variants) as the runtime role; RLS is evaluated on every statement.
- **Defense in Depth** – grants, RLS, `security_invoker` views and `SECURITY INVOKER`
  functions each limit damage if another layer is misconfigured.
- **Reference Monitor** – PostgreSQL RLS is the single authoritative enforcement point.
- **RBAC for global roles** – a User has 0..n Roles (`users`, `roles`, `user_roles`).
- **ReBAC-style relationships** – ownership and link tables derive from foreign keys.

## Identity

`users`, `roles`, `user_roles` and `auth_sessions` are framework-owned. An **Auth
Session** is an opaque server-side row that authenticates one User (it is not a
Runtime Instance or a Classroom Session). `userSQL(user)` / `userTransaction(user, …)`
validate the User ID and set `app.user_id` with `set_config(..., true)` (transaction
local). The database exposes it through:

- `chromatis.current_user_id()` – the current User ID, or `NULL` for `publicSQL`.
- `chromatis.has_role(key)` – whether the current User has the role.

There is no generic permission table; use roles plus `access.toml`.

The runtime role has **no** table privileges on framework state (`users`, `roles`,
`user_roles`, `auth_sessions`, `external_identities`, OIDC attempts). Runtime SQL cannot
change the authorization state it is checked against, nor read PIN hashes or sessions.
Framework code reaches that state only through narrow `chromatis.*` functions (see
below). Roles and role assignments are managed by owner-run migrations or admin tooling;
the only runtime path is `chromatis.register_user`, which makes the very first User an
admin. Roles referenced by `access.toml` must exist in `roles` (seed them in a migration
before generating); generation and the audit both check this.

## PostgreSQL roles

| Role                | Purpose                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `chromatis_owner`   | Owns schemas and tables, applies migrations (`DATABASE_MIGRATION_URL`). Never serves requests. |
| `chromatis_auth`    | `DATABASE_AUTH_URL`. Framework auth code only; direct grants on framework tables only.         |
| `chromatis_runtime` | `DATABASE_URL`. Not superuser, no `BYPASSRLS`, owns nothing, cannot migrate.                   |

`chromatis_runtime` and `chromatis_auth` are checked at connection time and by `bun run security:audit` (no superuser, no `BYPASSRLS`, owns nothing).

## access.toml

Each module declares table access in `src/modules/<module>/access.toml`:

```toml
[[access.courses.select]]
role = "teacher"

[[access.courses.select]]
role = "student"
through = "course_enrollments"

[[access.courses.update]]
role = "teacher"
user_column = "owner_id"

[[access.analytics_events.insert]]
public = true

[access.course_enrollments]   # declared, no rules: deny everything
force = true                  # optional FORCE ROW LEVEL SECURITY (default false)
                              # RLS itself is mandatory; FORCE is opt-in because the
                              # owner role runs migrations. What matters is that
                              # chromatis_runtime never owns tables, is no superuser
                              # and has no BYPASSRLS.
```

- Operations: `select`, `insert`, `update`, `delete`. Missing operation = deny.
- Rules for one operation combine with **OR**; conditions inside a rule with **AND**.
- Conditions: `role`, `user_column` (row column equals the current User; must be a
  foreign key to `users(id)`), `through` (link table with a foreign key to `users`
  and one to the protected table, derived automatically; set `through_user_column`,
  `through_column` and `through_references` only when ambiguous), or `public = true`
  (must be the only key; public access is always explicit).
- An empty rule is rejected (it would allow everyone). Unknown keys are rejected.
- Policy subqueries run with the caller's rights, so a `through` link table needs its own
  `select` rule that lets the User see their own link rows (for example
  `user_column = "user_id"`). Nothing is granted implicitly: generation and
  `security:check` fail with a clear error when the link table is undeclared or its select
  rules cannot expose the User's own rows.
- A table may be declared in only one module.

### Generating RLS

```sh
bun run db generate <module> <description>
```

generates the routine migration and, when `access.toml` changed, an idempotent
`MAJOR.MINOR.PATCH__<description>.sql` that enables RLS and recreates the policies
`<table>_<operation>`, plus `sql/access.manifest.json` (source hash, the SHA-256 of every
generated migration, per-policy expressions, hashes, roles and required foreign keys). Relationships are resolved
against the migrated schema through `DATABASE_MIGRATION_URL` (or `DATABASE_URL`), so
apply the table migrations first. Tables removed from `access.toml` keep RLS enabled
and lose their policies, so they fall back to deny. Policy definitions carry their hash
as a `COMMENT`, which lets the audit spot changes. `security:check` hashes each generated migration file, so any edit to one fails until it is regenerated.

RLS is not maintained by hand: `CREATE/ALTER/DROP POLICY`, row-level-security toggles
and `BYPASSRLS` are rejected in hand-written module migrations.

## Views and functions

- Views must use `WITH (security_invoker = true)`; materialized views are rejected
  because they bypass RLS. Views have no access rules of their own – tables are the
  security boundary.
- Application functions are `SECURITY INVOKER` (the PostgreSQL default). Application
  modules may not create `SECURITY DEFINER` functions. The only definer functions are
  `chromatis.has_role` (see below).

## Framework state and the auth principal

`chromatis_runtime` is shared by every query the application runs, and PostgreSQL cannot
tell a framework call from the same call issued through `publicSQL` / `userSQL`. A
privileged function that runtime SQL can execute is therefore reachable by _any_ runtime
SQL. So privileged framework operations do not live behind `chromatis_runtime` at all:

- `chromatis_auth` is a separate, non-privileged principal with its own credential
  (`DATABASE_AUTH_URL`). Only `@chromatis/base/auth` (`createAuthDatabase`) connects as
  it. It holds direct grants on the framework tables (`users`, `auth_sessions`, `roles`,
  `user_roles`, `external_identities`, OIDC attempts) and nothing else.
- `chromatis_runtime` has **no** privileges on those tables and cannot `SET ROLE` to the
  auth principal. Holding the runtime credential alone cannot create an Auth Session,
  impersonate a User, assign a role, enable a User or read PIN hashes.
- The Auth Session, registration/login, SSO and OIDC code runs as `chromatis_auth`. The
  checks live in TypeScript, where they can use real proofs: PIN verification before a
  session is issued, the validated OIDC ID token before an identity resolves, an
  administrator check (`hasRole` under the actor) before `setUserEnabled`.
- Registration takes an advisory transaction lock before deciding whether a User is the
  first, so simultaneous first registrations cannot all become administrators.

The only `SECURITY DEFINER` function is `chromatis.has_role(key)`. It reveals only the
current User's own roles, sets `search_path = pg_catalog, pg_temp`, uses schema-qualified
names, is revoked from `PUBLIC` and executable by `chromatis_runtime` only (the audit
enforces this). `chromatis.current_user_id()` is `SECURITY INVOKER`.

## Trust boundary

Chromatis uses the established pooled-PostgreSQL pattern: a trusted application layer
sets a transaction-local identity (`app.user_id`) and then runs **parameterized** queries
as `chromatis_runtime`; RLS enforces resource access. RLS therefore protects against
missing or incorrect application authorization and row filters. It does **not** claim to
preserve User identity after attacker-controlled SQL has been executed under the runtime
credential: such SQL could set `app.user_id` itself. The framework's job is to keep
attacker-controlled SQL from ever being executed:

- **Parameters only.** `publicSQL` / `userSQL` / the transaction callbacks accept tagged
  templates only. Interpolated values are always bound parameters; they can never become
  syntax. An object that merely looks like a SQL fragment (for example JSON from a
  request body) is just a parameter: only fragments created inside the framework count.
- **No raw SQL for applications.** There is no `unsafe` / string-query entry point;
  `sql.identifier(name)` accepts a plain identifier and quotes it. Raw SQL exists only in
  framework internals, migrations and tooling.
- **Identity is framework-owned.** `app.user_id` is set transaction-locally and only by
  the internal `userSQL` / `userTransaction` code, after the User ID is validated as a
  UUID. Query text containing `set_config`, `SET`/`RESET` of `app.*`, `ROLE` or
  `SESSION AUTHORIZATION`, or `DISCARD ALL` is rejected at run time. The ESLint rule
  `chromatis/no-raw-sql` (part of the shared config) flags `.unsafe(` and those
  patterns in application source, and `security:check` rejects them in hand-written
  migrations.
- **Least-privileged principals.** `chromatis_runtime` is non-owner, non-superuser and
  has no `BYPASSRLS`; framework state is reachable only by the separate `chromatis_auth`
  principal (see above).

If Chromatis ever intentionally exposes arbitrary user-controlled SQL or runs untrusted
plugins, this design must be revisited with a stronger mechanism, such as database-native
per-User identities or cryptographically protected context.

## Tooling

```sh
bun run security:check      # part of `bun run check`; no database needed
bun run security:describe   # central overview of every table's access rules
bun run security:audit      # verifies the live database (uses DATABASE_URL)
```

`security:check` verifies that `access.toml` parses, is in sync with the generated
migration and manifest, and that views, functions and hand-written migrations follow
the rules above. `security:audit` additionally verifies, against PostgreSQL: runtime
role is not superuser / `BYPASSRLS` / owner; RLS (and FORCE where declared) is on;
policies match the generated hashes with none missing or extra; undeclared tables the
runtime role can reach; required foreign keys exist; views are `security_invoker`;
and only audited `SECURITY DEFINER` functions exist. Live policies are compared with their declared definition (command, permissive mode, roles, `USING` and `WITH CHECK` as normalised by PostgreSQL), not just their comment. This and the role check need `DATABASE_MIGRATION_URL` (a rolled-back transaction as the owner role); without it the audit fails.
