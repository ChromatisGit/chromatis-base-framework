# @chromatis/base

Shared technical platform for Chromatis applications. This checkout implements the clean-break target architecture; consumers using the former `@chromatis/base`, `/db`, `/offline`, `/sqlite`, `/sync`, or `/schema` interfaces must migrate before updating their dependency.

## Public interfaces

| Import                             | Responsibility                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `@chromatis/base/ui`               | Opinionated UI, shell, layout, form, data-view, interaction, and authentication primitives |
| `@chromatis/base/styles`           | Shared Tailwind theme and tokens                                                           |
| `@chromatis/base/auth`             | Users, opaque sessions, roles/permissions, SSO contract, and OIDC/PKCE plumbing            |
| `@chromatis/base/database`         | PostgreSQL operations, explicit user RLS context, transactions, and startup migrations     |
| `@chromatis/base/config`           | TOML environment overlays with strict Zod validation                                       |
| `@chromatis/base/secrets`          | Secret definitions, validation, and safe status inspection                                 |
| `@chromatis/base/errors`           | Typed application errors and HTTP mapping                                                  |
| `@chromatis/base/log`              | Request-scoped structured JSON logging                                                     |
| `@chromatis/base/request-boundary` | One request-level typed-error boundary                                                     |
| `@chromatis/base/runtime`          | Explicit Bun and Cloudflare runtime construction                                           |
| `@chromatis/base/vite`             | Shared Vite setup                                                                          |

No package-root export exists. Import the capability that owns the behavior.

## Database contract

Applications start PostgreSQL through the framework-owned discovery path; they do not import or assemble raw migration files:

```ts
import { startDatabase } from "@chromatis/base/db-migrations";

const database = await startDatabase({
  databaseUrl: process.env.DATABASE_URL!,
  migrationDatabaseUrl: process.env.DATABASE_MIGRATION_URL,
  runtime: "bun",
  environment: "local",
});
```

`startDatabase` discovers framework and `src/modules/*/migrations` assets, checks routine manifests, and invokes the shared startup/CLI migration engine. Local and test startup require `DATABASE_MIGRATION_URL` and automatically apply pending migrations under an advisory lock. Production startup uses `DATABASE_URL` only, performs a read-only pending-migration check, and fails if the schema is behind; production migration credentials belong in the explicit `bun run db apply` environment, not the long-running application process.

The returned database exposes exactly four query operations:

- `anonSQL`
- `userSQL(user, ...)`
- `anonTransaction(operation)`
- `userTransaction(user, operation)`

Authenticated operations set only `app.user_id`. Roles and group keys are deliberately not connection context.

Application migrations live in `src/modules/<module>/migrations/MAJOR.MINOR.PATCH__description.sql`. Applied state is tracked by `(module, version)`. Declared routines live below each module's `sql/views` and `sql/functions`; generate their migration with `bun run db generate <module> <description>`.

### PostgreSQL roles and grants

Provision two login roles before running migrations:

- `chromatis_app` is the `DATABASE_URL` role. It must be `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`, must not own application tables, and receives only explicit grants required by each module. `anonSQL`, `userSQL`, and both transaction operations always use this credential.
- `chromatis_migrator` is the `DATABASE_MIGRATION_URL` role. It owns the database/application schema and all tables created by migrations. It should also be `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`; its extra authority comes from ownership and schema `CREATE`, not cluster-wide privileges.

For a new database, the administrator-owned bootstrap is equivalent to:

```sql
CREATE ROLE chromatis_migrator LOGIN PASSWORD '<migration-secret>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE chromatis_app LOGIN PASSWORD '<runtime-secret>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE DATABASE app_database OWNER chromatis_migrator;

-- Run while connected to app_database as its administrator/owner.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO chromatis_migrator;
GRANT CONNECT ON DATABASE app_database TO chromatis_app;
GRANT USAGE ON SCHEMA public TO chromatis_app;
```

The framework auth migration revokes public access and grants `chromatis_app` only the columns/actions needed for registration/login, opaque sessions, SSO identity resolution, and `chromatis.has_permission`. Its function is `SECURITY INVOKER`; it does not bypass table privileges or RLS. Every application migration must likewise enable/define RLS where appropriate, revoke public access, and grant only its runtime operations to `chromatis_app`. Do not use `GRANT ALL`, make `chromatis_app` an owner, or grant it `BYPASSRLS`.

## Configuration

Each owner keeps values in `config.toml` and a strict Zod schema in `config.ts`. Files use `[default]`, `[local]`, `[test]`, and `[production]` tables. `parseConfig` merges `[default]` with the selected environment, rejects unknown or invalid values, and returns an immutable result.

Secrets are never TOML values. Bun reads them from environment injection; Cloudflare passes bindings explicitly to `createCloudflareRuntime`.

## Quality

```sh
bun run check
bun run fix
bun run test
```

`check` is non-mutating and runs strict TypeScript, ESLint (including architecture rules), Prettier validation, and Bun tests. The shared architecture rules enforce dependency direction, module public-entry imports, and the `index.ts`-only module root convention.

The shared PWA manifest remains available at `@chromatis/base/infra/pwa/manifest`; it provides installability metadata only and has no offline cache or service worker.
