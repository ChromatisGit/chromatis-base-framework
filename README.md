# @chromatis/base

Shared technical platform for Chromatis applications. This checkout implements the clean-break target architecture; consumers using the former `@chromatis/base`, `/db`, `/offline`, `/sqlite`, `/sync`, or `/schema` interfaces must migrate before updating their dependency.

## Public interfaces

| Import                             | Responsibility                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `@chromatis/base/ui`               | Shared React UI and site shell                                                         |
| `@chromatis/base/styles`           | Brand-independent tokens, base, components, patterns, and shell CSS                    |
| `@chromatis/base/auth`             | Users, roles, Auth Sessions, SSO contract, and OIDC/PKCE plumbing                      |
| `@chromatis/base/database`         | PostgreSQL operations, explicit user RLS context, transactions, and startup migrations |
| `@chromatis/base/config`           | TOML environment overlays with strict Zod validation                                   |
| `@chromatis/base/secrets`          | Secret definitions, validation, and safe status inspection                             |
| `@chromatis/base/errors`           | Typed application errors and HTTP mapping                                              |
| `@chromatis/base/log`              | Request-scoped structured JSON logging                                                 |
| `@chromatis/base/request-boundary` | One request-level typed-error boundary                                                 |
| `@chromatis/base/runtime`          | Explicit Bun and Cloudflare runtime construction                                       |
| `@chromatis/base/vite`             | Shared Vite setup                                                                      |

No package-root export exists. Import the capability that owns the behavior.

## Shared UI

Import the framework styles and an application-owned theme in the application root CSS:

```css
@import "@chromatis/base/styles";
@import "./theme.css" layer(theme);
```

The framework entry orders tokens, theme, base, components, patterns, and shell layers. The
theme supplies the semantic color and font primitives selected by `data-brand` on
`<html>`. The prototype's `new-ui-style/src/css/themes/theme-demo.css` shows the
full light/dark contract. The local framework UI preview owns its example theme.

For a two-mode application, set its fixed `data-brand` on `<html>` and call
`colorModeInitScript(applicationStorageKey)` in a head script before paint.
The application theme supplies light values plus dark selectors for system
preference and explicit `data-theme="dark"`; an explicit `data-theme="light"`
must override a dark system preference. `useColorMode(applicationStorageKey)`
returns the current `system | light | dark` choice and a setter for an
application-owned settings control. It persists per application and keeps
multiple controls in sync. A light-only application omits the control and dark
selectors.

The shared UI exports Button (and `buttonClassName` for button-styled links), ActionLink, TextLink, IconButton, Card, ActionCard and card content
parts, Badge, Alert, fields, Choice and ChoiceGroup (checkbox and radio), Switch, the React Router Form wrapper, Page, Tabs, Accordion,
Dialog, Pagination, DataTable, record list parts, Spinner, Skeleton, Progress, and
EmptyState, SiteShell, Breadcrumbs, PageHeader, and service/editorial compositions. Dialog uses native modal behavior and becomes a bottom sheet on narrow
screens. Pagination takes real page URLs, so links work with browser navigation;
an optional callback supports client-managed paging. Applications supply labels and
content. The former UI exports and Tailwind theme have been removed. Consumers of the earlier UI API must migrate before updating.

`SiteShell` accepts an application-owned navigation tree, brand slot, labels, icons,
search/settings slots, and optional bottom navigation shortcuts. It uses React
Router links, opens the current section in the sidebar and mobile menu, closes
the mobile menu on Escape or navigation, and can remember the sidebar choice
under an application-specific storage key. For an unlisted detail route, pass
`currentParentTo` to mark its listed parent. Bottom navigation is omitted by
default. Applications supply three to five shortcuts when they use it.
`sidebarFooter` pins a control (`{ compact, full }`) to the bottom of the
sidebar; phones have no sidebar, so repeat it in `quickActions`.

```tsx
<SiteShell
  brand={
    <>
      <img className="brand__logo" src="/brand.svg" alt="" />
      <span className="brand__name">Portal</span>
    </>
  }
  brandTo="/"
  brandLabel="Portal home"
  navigation={sections}
  labels={labels}
  icons={icons}
  search={searchControls}
  settings={settingsControls}
  quickActions={mobileUtilities}
  utilities={desktopUtilities}
  bottomNavigation={shortcuts}
  sidebarStorageKey="portal-sidebar"
>
  <PageHeader
    title="Services"
    breadcrumbs={<Breadcrumbs label="Breadcrumb" items={trail} />}
  />
  {content}
</SiteShell>
```

All visible strings and destinations come from the application. `PageHeader`,
`ServiceAction`, `ServiceContent`, and `EditorialArticle` provide shared layout
and semantic markup while the application owns content and assets.

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

The returned database exposes exactly four query operations (see [SECURITY.md](SECURITY.md)):

- `publicSQL`
- `userSQL(user, ...)`
- `publicTransaction(operation)`
- `userTransaction(user, operation)`

Authenticated operations set only `app.user_id`; SQL reads it through `chromatis.current_user_id()` and checks roles with `chromatis.has_role('key')`. `publicSQL` has no User identity and is not privileged: it can only reach data with an explicit `public = true` rule.

Application migrations live in `src/modules/<module>/migrations/MAJOR.MINOR.PATCH__description.sql`. Applied state is tracked by `(module, version)`. Declared routines live below each module's `sql/views` and `sql/functions`, and table access rules in `access.toml`; generate their migrations with `bun run db generate <module> <description>`. Views must be `security_invoker` and application functions `SECURITY INVOKER`.

### PostgreSQL roles and grants

Provision three login roles before running migrations:

- `chromatis_runtime` is the `DATABASE_URL` role. It must be `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`, must not own application tables, and receives only explicit grants required by each module. `publicSQL`, `userSQL`, and both transaction operations always use this credential.
- `chromatis_auth` is the `DATABASE_AUTH_URL` role, used only through `createAuthDatabase` by Auth Sessions, registration/login, SSO and OIDC. It has direct grants on framework tables only; `chromatis_runtime` has none, so the application credential cannot forge sessions or roles.
- `chromatis_owner` is the `DATABASE_MIGRATION_URL` role. It owns the database/application schema and all tables created by migrations. It should also be `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`; its extra authority comes from ownership and schema `CREATE`, not cluster-wide privileges.

For a new database, the administrator-owned bootstrap is equivalent to:

```sql
CREATE ROLE chromatis_owner LOGIN PASSWORD '<migration-secret>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE chromatis_runtime LOGIN PASSWORD '<runtime-secret>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE chromatis_auth LOGIN PASSWORD '<auth-secret>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE DATABASE app_database OWNER chromatis_owner;

-- Run while connected to app_database as its administrator/owner.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO chromatis_owner;
GRANT CONNECT ON DATABASE app_database TO chromatis_runtime, chromatis_auth;
GRANT USAGE ON SCHEMA public TO chromatis_runtime;
```

The framework auth migration grants `chromatis_runtime` no table privileges on framework state; registration/login, Auth Sessions, SSO and OIDC run as `chromatis_auth`. The only definer function is `chromatis.has_role()`, next to `chromatis.current_user_id()`. Application tables declare their RLS in `access.toml` (generated, never hand-written); migrations revoke public access and grant only the runtime operations to `chromatis_runtime`. Do not use `GRANT ALL`, make `chromatis_runtime` an owner, or grant it `BYPASSRLS`.

## Configuration

Each owner keeps values in `config.toml` and a strict Zod schema in `config.ts`. Files use `[default]`, `[local]`, `[test]`, and `[production]` tables. `parseConfig` merges `[default]` with the selected environment, rejects unknown or invalid values, and returns an immutable result.

Secrets are never TOML values. Declare them in `src/app/config/secrets.ts`
or an owner-local `src/modules/*/secrets.ts`, beside the same project structure
used for TOML configuration. `bun run secret` opens an interactive menu to
set, replace and remove secrets. Local values use the operating
system's credential store; production values use the project's Wrangler
configuration. Status reports presence only, and values are accepted only
through hidden terminal input.

## Quality

```sh
bun run check
bun run fix
bun run test
```

`check` is non-mutating and runs strict TypeScript, ESLint (including architecture rules), Prettier validation, config and generated-migration checks, `security:check` (access rules and SQL invariants) and Bun tests. `bun run security:describe` prints every table's access rules and `bun run security:audit` verifies a live database. The shared architecture rules enforce dependency direction, module public-entry imports, and the `index.ts`-only module root convention.

The shared PWA manifest remains available at `@chromatis/base/infra/pwa/manifest`; it provides installability metadata only and has no offline cache or service worker.
