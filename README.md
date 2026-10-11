# @chromatis/base

Shared technical platform for Chromatis products. A **product** is a package that declares modules (`@chromatis/base/module`); an **instance** is a deployable application that depends on one product, configures it with `config/*.toml`, and is built, checked and deployed by the `chromatis` command. Chromatis owns configuration, module discovery, the build and deploy lifecycle, security (Auth Sessions, PostgreSQL row-level security), the Stateful Runtime, shared UI and the quality gates. Products own functionality. The architecture documentation in the private planning repository explains how the parts fit; this file is the reference for using them.

## Public interfaces

| Import                                                                   | Responsibility                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `@chromatis/base/module`                                                 | `defineModule`, route declarations, `moduleConfig`, manifest creation       |
| `@chromatis/base/virtual-modules`                                        | Types of the generated `chromatis-config` and `chromatis-artifacts` modules |
| `@chromatis/base/testing`, `/test-preload`                               | Injecting config, app and artifacts into unit tests                         |
| `@chromatis/base/config`                                                 | TOML environment overlays with strict Zod validation                        |
| `@chromatis/base/secrets`                                                | Secret definitions, validation and safe status inspection                   |
| `@chromatis/base/auth`                                                   | Users, roles, Auth Sessions, SSO contract, OIDC/PKCE plumbing               |
| `@chromatis/base/database`                                               | PostgreSQL operations, explicit user RLS context, transactions              |
| `@chromatis/base/db-migrations`                                          | Startup migration discovery and execution                                   |
| `@chromatis/base/stateful`, `/stateful/*`                                | Stateful Runtime contract, Bun and Cloudflare hosts, test harnesses         |
| `@chromatis/base/server-hook`                                            | The server hook contract (`ServerHook`)                                     |
| `@chromatis/base/runtime`                                                | Explicit Bun and Cloudflare runtime construction                            |
| `@chromatis/base/errors`, `/log`, `/request-boundary`                    | Typed errors, structured logging, the request error boundary                |
| `@chromatis/base/ui`, `/styles`                                          | Shared React UI and brand-independent CSS                                   |
| `@chromatis/base/vite`                                                   | The Vite configuration used by `chromatis` builds                           |
| `@chromatis/base/infra/tsconfig`, `/infra/eslint`, `/infra/pwa/manifest` | Shared TypeScript base, ESLint config, PWA manifest                         |

No package-root export exists. Import the capability that owns the behavior.

## Modules

A product declares each module in `module.ts` and lists them in a generated manifest.

```ts
import { defineModule, z } from "@chromatis/base/module";

export default defineModule({
  name: "classroom", // the module directory name; "app" is reserved
  config: {
    schema: z.object({ ttlHours: z.number().default(12) }).strict(),
    required: false,
  },
  secrets: [
    {
      name: "SESSION_KEY",
      description: "Signs join codes",
      required: "always",
    },
  ], // or "production"
  runtime: ["room"], // Stateful Runtime kinds; requires serverHook
  serverHook: "server/hook.ts", // relative to this file
  database: false, // uses PostgreSQL
  contributions: [{ id: "catalog", module: "@product/compiler/contribution" }], // export defaults to "default"
  artifacts: [
    {
      id: "catalog",
      path: "catalog",
      validator: { module: "@product/contract/validate", export: "validate" },
    },
  ],
  routes: [{ path: "join", file: "./routes/join.tsx" }],
});
```

Declarations are validated strictly (unknown keys, duplicates and unsafe paths are errors); config schemas must be `.strict()`, including nested objects, and must produce plain JSON data. Secret names `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `DATABASE_AUTH_URL` and the Cloudflare credentials are reserved.

A script of the product package writes the manifest with `createManifest(modules, { root, routes })` and `serializeManifest`, and the package's `package.json` points at it: `"chromatis": { "manifest": "./dist/chromatis.manifest.json" }`. The manifest (format version 1) lists per module its `name`, `entry` (importable specifier of `module.ts`), `config` summary (`required`, `keys`), `secrets`, `runtime`, `serverHook`, `database`, `contributions`, `artifacts` and `routes`, plus an optional package-level `app: { root, routes }`. Lists are sorted; modules are unique and sorted by name. Chromatis imports each `entry` for the real declaration and reports a manifest that no longer matches it.

Chromatis finds the manifest by scanning the instance's direct dependencies for `chromatis.manifest`; exactly one dependency may carry it. Dependencies are resolved through `node_modules` and symlinks, so linked packages, workspace members and tarballs all work.

## Instances

An instance contains: `package.json` (dependencies, and scripts that call `chromatis`), `config/*.toml`, content or `public/` assets, the two root stubs `tsconfig.json` and `eslint.config.js` (one line each, extending the generated files in `.chromatis/`; TypeScript, editors, `vite-tsconfig-paths` and ESLint look for them at the project root), and optionally `app/routes.ts`, `app/root.tsx` and the files they reference. Dependencies must include `react`, `react-dom`, `react-router`, `@react-router/node` and `isbot`, because React Router inspects the app's own `package.json`. Wrangler configuration, Dockerfile, compose file, Vite and React Router configuration, route re-export files and the React Router app directory are generated under the git-ignored `.chromatis/`.

### Configuration

`config/app.toml` is owned by Chromatis:

```toml
[deployment]
target = "cloudflare"       # or "bun" (a Bun server in Docker)
domain = "example.org"      # host name only; "localhost" gives http://localhost:<port>
# name = "my-worker"        # Worker/service identity; defaults to the package name without scope
# port = 3000               # Bun server port

[modules]
disabled = ["classroom"]    # modules of the product this instance does not use

[routes]
omit = ["/"]                # product route paths this instance replaces with its own
```

`config/<module>.toml` is validated against the module's schema. Every file uses `[default]`, `[local]`, `[test]` and `[production]` overlays: top-level tables are the base layer, then `[default]`, then the environment table; tables merge recursively, arrays are replaced. The effective environment is local for `dev`, `check`, `fix`, `inspect` and `init`, production for `build`, `deploy` and `doctor`, overridable with `--env local|test|production`; `check` validates all three.

Unknown keys, invalid values, missing required values, config files without a module, committed secrets (a declared secret name, keys such as `apiKey` or `client_secret`, URLs with embedded passwords, private keys) and values JSON cannot carry unchanged are errors, reported together with file and key. Defaults exist only as schema defaults. A module with `config.required` needs its file even if every value has a default; without it a missing file means the defaults. A disabled module contributes no runtime kinds, server hook, database, secrets, contributions, artifacts or routes; its config file is neither required nor allowed; unknown names are errors.

### Editor support

Install the "Even Better TOML" extension (Taplo) in VS Code. Each hand-written TOML file then starts with a line such as `#:schema ../.chromatis/schemas/catalog.schema.json`, and the editor completes keys, shows descriptions and flags unknown keys and wrong values. The schemas are generated from the Zod schemas under `.chromatis/schemas/` by `chromatis init`; `chromatis fix` adds the line to new files and `chromatis check` reports files without it. Describe a field for the hover text with `.describe("…")`. Modules whose content lives outside `config/` declare it with `authoredFiles` (see the architecture documentation in the private planning repository).

### Secrets

Modules declare secrets (`always` or `production`); values are never in TOML. `chromatis secret` is an interactive menu over every declared secret, the secrets Chromatis derives when a module uses PostgreSQL (`DATABASE_URL`, `DATABASE_MIGRATION_URL`) and the Cloudflare credentials. Values are typed into a masked prompt and stored in the operating system credential store under the service `dev.chromatis.<application name>`; they never appear in arguments or shell history. Lookups prefer an environment variable (CI, and the `.env.local` file Bun loads), then the credential store. Cloudflare receives secrets through Wrangler's standard input at deploy; Docker receives them in `.chromatis/build/app.env` (mode 0600).

### Runtime access to configuration

The build generates two virtual modules, available at module load time on every target (Vite dev, Cloudflare Worker, Bun/Docker, and plain Bun when Chromatis imports the server hook or runs `Bun.build`):

```ts
import { config, app } from "chromatis-config";
// config[moduleName]: validated, non-secret configuration of the active modules for the build environment
// app: { name, domain, publicUrl, environment }; publicUrl is also the PUBLIC_URL variable
import { artifacts } from "chromatis-artifacts";
// artifacts[id] = { basename, files: { "relative/path": base64 } }, exactly the validated directories
```

Read a typed module configuration with `moduleConfig(declaration, config)`; the value was validated when the instance was built and is not parsed again. Secrets are not part of these modules: they reach `hook.createService(host, env)` through the environment bindings. Declare the module types with `/// <reference types="@chromatis/base/virtual-modules" />` (plus `export {};` if the file has no other import or export) in one file of the product.

In unit tests add `[test] preload = ["@chromatis/base/test-preload"]` to `bunfig.toml` and inject values:

```ts
import { injectChromatis } from "@chromatis/base/testing";
const restore = injectChromatis({
  config: { classroom: { ttlHours: 1 } },
  app: { publicUrl: "https://x.org" },
  artifacts: {},
});
restore(); // injections nest; without injection config is empty and app describes a local test application
```

### Routes and root

A product declares routes as data (`routes` of `defineModule`, and `createManifest(..., { root, routes })` for the package itself):

```ts
type RouteDeclaration = {
  path?: string; // a route
  index?: true; // an index route
  layout?: true; // a pathless layout (with children)
  id?: string; // default "routes/<file name>"; needed when a file serves two routes
  file: string; // package-exported specifier, or "./…" relative to the module directory (manifest: to the manifest file)
  children?: RouteDeclaration[];
};
```

Exactly one of `path`, `index`, `layout` is set. Chromatis writes `.chromatis/app/` (`root.tsx`, `routes.ts`, one re-export per route with the export names read from the route file) and points React Router's `appDirectory` at it. An instance may add routes in `app/routes.ts` (a default-exported `RouteConfig`, files relative to its `app/`; they are appended after the product's) and may replace the root with `app/root.tsx`. To replace a product route, list its URL path under `[routes] omit`.

## Commands

`chromatis` is the bin of this package (`infra/scripts/chromatis.ts`). Run it in an instance root.

| Command                                       | What it does                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check [--env e] [--no-scripts]`              | Non-mutating. Tooling files; discovery and manifest; module declarations; configuration in all environments; secrets hygiene; routes (files, ids, paths, root, the instance's own routes); build contributions run into a temporary directory and every artifact validated; then the typecheck, lint, format and test gates.                |
| `fix`                                         | Only: creates missing `config/<module>.toml` files of modules with `config.required` whose every value has a schema default, sets the editor schema line (`#:schema …`) of hand-written TOML files, and runs Prettier on the files the format gate checks. Never decides target, domain, content or credentials; anything else is reported. |
| `inspect [--json] [--env e]`                  | Prints modules, disabled modules with the reason, effective configuration (credential-looking values redacted), root and routes, contributions, artifacts, secrets and unmet requirements.                                                                                                                                                  |
| `doctor [--json] [--offline] [--target t]`    | `inspect` plus the deployment preflight.                                                                                                                                                                                                                                                                                                    |
| `build [--target t]`                          | Validate configuration, run contributions, validate artifacts, embed them, build the application, run the static preflight.                                                                                                                                                                                                                 |
| `dev`                                         | The same preparation, then the React Router dev server.                                                                                                                                                                                                                                                                                     |
| `deploy [--target t] [--dry-run] [--offline]` | Instance `check`, contributions and artifacts, preflight, build, post-build preflight, database migrations, secret upload, deployment, smoke test. `--dry-run` stops before anything is migrated, uploaded or deployed; `--offline` limits the preflight to what needs no secrets or network.                                               |
| `secret`                                      | The secrets menu.                                                                                                                                                                                                                                                                                                                           |
| `init`                                        | Writes the root stubs, `.gitignore` entries and everything generated under `.chromatis/`, including the editor schemas in `.chromatis/schemas/`. Run it after a fresh clone.                                                                                                                                                                |
| `check-tooling`                               | Only the tooling-file part of `check`.                                                                                                                                                                                                                                                                                                      |

`--target` is `cloudflare`, `bun` or `docker` (the last two are the same Bun server build); it defaults to `[deployment] target`.

**Build lifecycle.** Contributions run in contribution-id order, each into a fresh `.chromatis/artifacts/<id>/`, called as `(await import(module))[export ?? "default"]({ instanceRoot, outDir, environment, config })` where `config` holds the validated module configs by module name; the first failure aborts with the contribution id. An artifact is valid when `.chromatis/artifacts/<path>` exists and its validator `(dir) => { ok: true } | { ok: false; errors: string[] }` accepts it; errors of all artifacts are listed together. The validated directories are embedded as `chromatis-artifacts`; a digest recorded at embedding time lets `doctor` detect a build that no longer matches the artifact.

**Check gates.** For `typecheck`, `lint`, `format:check` and `test` an instance's own `package.json` script of that name runs if it exists. Otherwise Chromatis runs a default for `typecheck` (`react-router typegen`, `tsc --noEmit`), `lint` (`eslint . --max-warnings 0`) and `format:check` (`prettier` on `app`, `src`, `server`, `package.json`), skipped when the tool is not installed; `test` has no default. `CHROMATIS_CHECK_ACTIVE` stops a script that calls `chromatis check` from recursing.

**Preflight** lists every failure at once: tooling files; valid artifacts that match what was embedded; the server hook loads and its definitions match the declared runtime kinds; the runtime-migration ledger; static database and security checks and a database connection when a module uses PostgreSQL; every secret required for the environment; an example or `localhost` domain on Cloudflare; Wrangler and Cloudflare credentials, or Docker. See the deployment documentation in the private planning repository.

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

`startDatabase` discovers framework and `src/modules/*/migrations` assets, checks routine manifests, and invokes the shared startup/CLI migration engine. Local and test startup require `DATABASE_MIGRATION_URL` and automatically apply pending migrations under an advisory lock. Production startup uses `DATABASE_URL` only, performs a read-only pending-migration check, and fails if the schema is behind; production migration credentials belong in the explicit migration step (`chromatis deploy` applies pending migrations before it uploads; `bun run db apply` in the product package does so by hand), not the long-running application process.

The returned database exposes exactly four query operations (see the security documentation in the private planning repository):

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

## Configuration helpers

`@chromatis/base/config` is the layer behind `config/*.toml`: `parseConfig(source, environment, schema)` merges the layers and returns an immutable, validated result or throws a `ValidationError` with the issues per key; `parseConfigResult` returns the issues instead of throwing.

## Quality

```sh
bun run check
bun run fix
bun run test
```

`check` is non-mutating and runs strict TypeScript, ESLint (including architecture rules), Prettier, generated-migration checks, `security:check` (access rules and SQL invariants) and the Bun tests, including real builds of a fixture application for both targets. `bun run security:describe` prints every table's access rules and `bun run security:audit` verifies a live database. The shared architecture rules (`@chromatis/base/infra/eslint`) enforce dependency direction between `app`, `modules`, `adapter` and `helper`, imports of other modules through their public `index.ts`, and the module root layout (`index.ts`, `module.ts`, `module.test.ts` only). The `db` and `security` tools act on the `src/modules/*` of the directory they run in, which is the product package.

The shared PWA manifest is available at `@chromatis/base/infra/pwa/manifest`; it provides installability metadata only and has no offline cache or service worker.
