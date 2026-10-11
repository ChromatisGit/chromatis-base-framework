# Chromatis architecture

## 1. Purpose

Chromatis is shared infrastructure for a small set of related web applications. It centralizes the technical decisions that should be identical across them: configuration, module discovery, the build and deploy lifecycle, security, database conventions, the Stateful Runtime, shared UI and the quality gates. Products contain product logic only.

> Products own functionality. Modules own their capabilities. Chromatis owns shared technical infrastructure and its initialization.

Chromatis is deliberately not a general application framework. Its abstractions are small, explicit and mechanically enforced, and nothing in it knows any product.

## 2. Stack

| Area                      | Standard                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------- |
| Runtime / package manager | Bun                                                                                   |
| Language                  | TypeScript, strict mode                                                               |
| UI                        | React 19, React Router 7                                                              |
| Build                     | Vite 7                                                                                |
| Validation                | Zod                                                                                   |
| Configuration             | TOML                                                                                  |
| Database                  | PostgreSQL, handwritten SQL, no ORM                                                   |
| Deployment                | Cloudflare Workers (Wrangler) or a Bun server in Docker                               |
| Quality gates             | TypeScript, ESLint, Prettier, architecture rules, database and security checks, tests |

## 3. Vocabulary

- **Product**: a package that declares **modules** and a manifest. It contains the code, routes, schemas and compiler hooks of an application family.
- **Module**: a unit of a product with its own configuration schema, secrets, Stateful Runtime kinds, server hook, database use, build contributions, artifacts and routes. It is declared with `defineModule`.
- **Instance**: a deployable application. It depends on exactly one product, owns `config/*.toml` and content, and is operated by the `chromatis` command. One product can back several instances that differ in configuration, content, disabled modules and own routes.
- **Manifest**: a generated JSON summary of a product's modules that Chromatis can read without executing code.
- **Artifact**: a validated directory produced at build time by a build contribution (or supplied) and embedded in the application.

## 4. Modules and discovery

A module declaration (`@chromatis/base/module`) contains:

| Field           | Meaning                                                                                 |
| --------------- | --------------------------------------------------------------------------------------- |
| `name`          | The module directory name. `app` is reserved for Chromatis' own configuration.          |
| `config`        | A strict Zod schema for `config/<name>.toml`, and whether the file must exist.          |
| `secrets`       | Names with a description, required `always` or in `production` only.                    |
| `runtime`       | Stateful Runtime kinds; the module's `serverHook` file supplies their definitions.      |
| `database`      | The module uses PostgreSQL.                                                             |
| `contributions` | Build steps: an importable function that writes `<outDir>/<id>/`.                       |
| `artifacts`     | Directories under `.chromatis/artifacts/` the build embeds, with an optional validator. |
| `authoredFiles` | Importable functions that tell editors which schema each hand-written file follows.     |
| `routes`        | React Router routes as data (section 8).                                                |

`defineModule` validates strictly and freezes the result. Schemas must be `.strict()` at every object level so a misspelled key is an error, and must produce plain JSON data because runtime code receives it as generated JSON.

The package generates its manifest with `createManifest`: format version 1, modules sorted and unique, every list sorted, one summary per module (name, `entry` specifier, config keys and required flag, secrets, runtime, hook, database, contributions, artifacts, routes) plus an optional package-level `app: { root, routes }`. The package's `package.json` names the file in `"chromatis": { "manifest": … }`.

Discovery scans the instance's direct dependencies, resolving them through `node_modules` and symlinks (so links, workspace members and tarballs behave alike), and requires exactly one dependency with `chromatis.manifest`. Chromatis then imports each module's `entry`, revalidates the declaration, and fails on a stale manifest, a name mismatch, a missing server hook file or cross-module conflicts (duplicate runtime kinds, secrets, contribution or artifact ids and paths, more than one server hook). Instances never register modules.

An instance may switch modules off with `[modules] disabled` in `config/app.toml`. A disabled module is dropped before any aggregation: it contributes nothing, needs no configuration, and conflicts with it do not count. `inspect` lists it with the reason.

## 5. Configuration and secrets

Configuration is TOML for values and Zod for schemas.

```text
config/app.toml          Chromatis-owned: [deployment], [modules], [routes]
config/<module>.toml     owned by the module that declares config
```

Every file supports the overlays `[default]`, `[local]`, `[test]`, `[production]` on top of top-level tables. Layers merge recursively; arrays are replaced; the result is frozen. `check` validates all environments, so a production-only mistake is found on a developer machine, and reports each problem once with file and key.

Errors, not silent behavior: unknown keys, invalid values, missing required values, config files whose module does not exist or declares no config, a config file of a disabled module, committed secrets and non-JSON values. Defaults live only in schemas. `fix` may create a missing file only when the module requires it and every value has a schema default.

`config/app.toml` holds only decisions that belong to no module: `[deployment] target` (`cloudflare` or `bun`), `domain`, optional `name` and `port`; `[modules] disabled`; `[routes] omit`. Target and domain are never defaulted. The public URL is derived from the domain.

**Editor support.** Completion and validation of the TOML files in an editor (Taplo, "Even Better TOML" in VS Code) is derived from the same schemas; nothing is configured by hand. `init` writes one JSON Schema per `loadInstance` config slot (`app` and each active module's `config`) into `.chromatis/schemas/`, converted with Zod's own `z.toJSONSchema` (input side, draft 07). Zod stays the validation authority: checks JSON Schema cannot express (`refine`, `superRefine`, custom types) are left to `check`. A config file's schema describes the layers, not the merged result: the top level, `[default]` and each environment table are partial overlays, so no key is required there (required values are checked after merging), while list items replace as a whole and keep their required keys. Taplo reads its configuration only from the workspace root, so a file is associated with its schema by a first line `#:schema <relative path>`, which `fix` adds and `check` verifies; no generated file lands in the instance root.

Hand-written files outside `config/` (a product's content, for example) are declared with `authoredFiles`: an importable function `(context) => [{ name, include, schema }]`, given the instance root, environment and validated module configuration, so the module decides the paths and the schemas and Chromatis only learns that files matching a glob follow a schema. Per module the first matching association wins; a file claimed by two modules is a problem.

Secrets are typed requirements, never TOML values. Modules declare them; Chromatis adds `DATABASE_URL` and `DATABASE_MIGRATION_URL` when a module uses PostgreSQL. A committed TOML key that matches a declared secret or looks like a credential, a URL with an embedded password and a private key are errors. Values come from environment variables (including Bun's `.env.local`) or the operating system credential store, entered through one masked prompt (`chromatis secret`); they reach Cloudflare through Wrangler's standard input and Docker through a mode-0600 env file. Status output reports presence only.

## 6. Runtime access to configuration

Module configuration must be available when module code loads (Durable Object definitions are created at import), on every target. The build therefore generates two virtual modules under `.chromatis/build/`:

- `chromatis-config` exports `config[moduleName]`, the validated configuration of the active modules for the build environment, and `app` (`name`, `domain`, `publicUrl`, `environment`);
- `chromatis-artifacts` exports `artifacts[id]`, the embedded artifact files.

They are resolved by a Vite alias in dev and builds, and by a Bun plugin when Chromatis itself imports the server hook or bundles the Bun image, so no product package needs a `paths` entry. Neither module contains secrets. `moduleConfig(declaration, config)` returns a typed value. For unit tests, `@chromatis/base/test-preload` registers the modules as live views over values set with `injectChromatis`.

## 7. Build lifecycle

```text
validate configuration
 → run build contributions (id order, each into a fresh .chromatis/artifacts/<id>/)
 → validate every declared artifact (exists; validator ok; errors aggregated)
 → embed exactly those directories (chromatis-artifacts, with recorded digests)
 → generate provider files and the React Router app directory
 → build the application (client + server)
 → static preflight
 → (deploy only) preflight, migrations, secret upload, deployment, smoke test
```

A contribution is a function `(ctx: { instanceRoot, outDir, environment, config }) => Promise<void>` in the product's own dependencies; it uses structural types and imports nothing from Chromatis. The application consumes exactly the artifact that was embedded; nothing is rebuilt or read from elsewhere at runtime. A missing, invalid or incompatible artifact therefore fails in `check` and `build`, not in production.

`check` is the non-mutating form: contributions run into a temporary directory that is removed afterwards, and artifacts that no contribution produces are validated where they are.

## 8. Routes and root

A product declares its root file and routes as data, mirroring React Router's config: a route (`path`), an index route, or a pathless layout, each with a file, an optional id and children. The default id is `routes/<file name>`, as in React Router; two routes with the same file need explicit ids. Chromatis resolves every file with the instance's module resolution and checks that ids and URL paths are unique across the package and its active modules.

React Router needs route files in an app directory, so Chromatis generates `.chromatis/app/` and points `appDirectory` there: a `root.tsx`, a `routes.ts` with the route tree, and one re-export file per route whose export names are read from the route file. During a build the re-exports are temporarily inlined so React Router can split server and client exports; in dev they stay re-exports and Vite serves the product sources directly.

An instance extends this without repeating it. Its `app/routes.ts` (a `RouteConfig`) is appended after the product's routes, its `app/root.tsx` replaces the product root, and `[routes] omit` lists product URL paths it replaces. A route of the instance that reuses a product path or id is a `check` error.

## 9. Commands

| Command              | Purpose                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check`              | Deterministic, non-mutating gate: tooling files, discovery, declarations, configuration, secrets hygiene, routes, artifacts, then typecheck, lint, format and test.     |
| `fix`                | Safe repairs only: required config files from schema defaults, formatting.                                                                                              |
| `inspect` / `doctor` | Diagnostics: modules, disabled modules, effective configuration, routes, contributions, artifacts, secrets, unmet requirements; `doctor` adds the deployment preflight. |
| `build`, `dev`       | Lifecycle through the application build; `dev` then starts the dev server.                                                                                              |
| `deploy`             | Preflight, build, migrations, secrets, deployment, smoke test; `--dry-run`, `--offline`.                                                                                |
| `secret`, `init`     | Secrets menu; (re)generate the root stubs and everything under `.chromatis/`.                                                                                           |

Instance `package.json` scripts call these. `check` runs an instance's own `typecheck`, `lint`, `format:check` and `test` scripts when it defines them and Chromatis' defaults for the first three otherwise (skipped when the tool is not installed), and an environment guard prevents recursion when a script itself calls `check`. The `db` and `security` tools are scripts of this package that act on the `src/modules/*` of the directory they run in, normally the product package.

## 10. Generated files

Everything an instance would otherwise repeat is generated, and git-ignored, under `.chromatis/`:

```text
tsconfig.json, eslint.config.js, types.d.ts     extended by the one-line root stubs; ambient types of the virtual modules
app/                                            React Router root, routes and re-exports
artifacts/<path>/                               contribution output, validated
build/artifacts.ts, artifacts.json              chromatis-artifacts and its digests
build/config.ts                                 chromatis-config
build/application.json                          facts for the Vite configuration
build/worker.ts, wrangler.json                  Cloudflare entry and configuration
build/bun.ts, compose.json, app.env             Bun/Docker entry, compose file, environment (mode 0600)
image/                                          bundled server and client for the Docker image
runtime-migrations.json                         Durable Object migration ledger (committed)
```

`react-router.config.ts` is generated at the instance root, also git-ignored. The two root stubs (`tsconfig.json`, `eslint.config.js`) stay in the instance because TypeScript, editors, `vite-tsconfig-paths` and ESLint look for them there.

## 11. Deployment

Supported targets are Cloudflare (Workers with static assets and Durable Objects) and a Bun server, locally or in Docker. Both run the same domain code; only the runtime host differs.

**Cloudflare.** The Worker entry creates the framework worker around the React Router server build, the server hook and one Durable Object class per Stateful Runtime kind. Durable Object migrations are tracked in `.chromatis/runtime-migrations.json`, which only ever appends tags and is committed. The Wrangler configuration sets `PUBLIC_URL`; secrets are uploaded with `wrangler secret put` and the Worker is deployed with the generated configuration. A smoke test requests the public URL and, if the custom domain is not reachable yet, the `workers.dev` URL, and probes the hook's realtime route.

**Bun / Docker.** The server entry and the server build are bundled into `.chromatis/image` and built with the framework Dockerfile; artifacts and configuration are embedded in the bundle, so the image needs no mounted content. Compose passes `PORT`, `PUBLIC_URL` and the declared secrets from the generated env file.

**Preflight** runs before a deploy and in `doctor`, and returns one aggregated list: tooling files, valid artifacts that match what the build embedded, a loadable server hook whose definitions match the declared kinds, the migration ledger, static database and security checks and a database connection when a module uses PostgreSQL, all required secrets for the environment, a real public domain, and target availability (Wrangler, Cloudflare credentials and a Wrangler dry run, or Docker). Production migrations are explicit: deploy applies them with the owner credential, and the long-running process only checks that the schema is current.

An application that needs no database runs without one.

## 12. Code structure rules

Product code follows one layering, enforced by the shared ESLint rules:

```text
src/
├── app/       composition root: routing, providers, orchestration only
├── modules/   encapsulated capabilities; <name>/index.ts is the only public entry
├── adapter/   domain-neutral external integrations
└── helper/    small, stateless, single-file utilities
```

`app` may use modules through their public interfaces; a module may use another module only through its `index.ts`; `helper` depends on no layer; adapters stay domain-neutral; there are no deep imports across modules and no import cycles. A module directory directly contains only `index.ts`, `module.ts` (its Chromatis declaration) and `module.test.ts`. Modules are cut by responsibility, not by technical layer, and talk to each other by direct, typed calls; there is no event bus, dependency-injection container or auto-registration between modules.

## 13. UI and design system

`@chromatis/base/ui` and `@chromatis/base/styles` provide spacing, typography, radii, control sizes, focus, motion, layout and shell tokens, semantic color roles, generic components (buttons, links, forms, cards, feedback, overlays, navigation, data views, the site shell), keyboard and focus behavior, responsive behavior, color-mode mechanics and the ordered stylesheet layers. Applications supply theme values, palette mapping, fonts, imagery, navigation data and wording; themes change values, not component markup or interaction.

## 14. Database model

PostgreSQL is the system of record. Modules own their tables, SQL and migrations; Chromatis owns connectivity, transaction plumbing, RLS context, access compilation, migration infrastructure and the security checks. Application code never receives a raw connection.

The application-facing interface has four operations: `publicSQL`, `userSQL(user)`, `publicTransaction` and `userTransaction(user)`. The User is always passed explicitly; there is no mutable global current user. `publicSQL` is not privileged: it reaches only data with an explicit public rule. Authenticated operations set exactly one identity value, `app.user_id`, transaction-locally; SQL reads it with `chromatis.current_user_id()` and checks roles with `chromatis.has_role(key)`.

Three login roles separate duties: `chromatis_owner` owns the schema and applies migrations, `chromatis_runtime` serves requests (not a superuser, no `BYPASSRLS`, owns nothing, cannot migrate) and `chromatis_auth` is used only by framework authentication code with grants on framework tables only. Details and the trust boundary are in [docs/SECURITY.md](docs/SECURITY.md).

## 15. Authorization and table access

Authorization is deliberately small: one persistent User id, zero or more Roles per User, PostgreSQL tables, Row-Level Security and relational ownership or membership. RLS is the authoritative enforcement layer and a missing rule means deny. The principles are Default Deny, Least Privilege, Complete Mediation, Defense in Depth, a single reference monitor, RBAC for global roles and relationship-based access for resources.

Framework-owned identity tables are `users`, `roles`, `user_roles` and `auth_sessions`. Applications own the role keys and their meaning.

Modules declare table access in `access.toml`: per table and operation (`select`, `insert`, `update`, `delete`) a list of rules combined with OR, each rule combining its conditions with AND. A condition is a `role`, a `user_column` (the row column equals the current User), a `through` link table (relationship derived from foreign keys, explicit columns only when ambiguous) or an explicit `public = true`. Chromatis compiles the declarations to idempotent RLS migrations and records a manifest with hashes so drift is detected mechanically. Hand-written policies are rejected.

## 16. Migrations, views and functions

Structural migrations are module-owned files `src/modules/<name>/migrations/MAJOR.MINOR.PATCH__description.sql`, tracked by `(module, version)`, discovered deterministically and applied under an advisory lock. They are immutable once released. Views (`sql/views`) and functions (`sql/functions`) are kept as current-state source files; a generator compares them with a committed manifest and writes migrations for changes, and `check` fails on drift. Views must be `security_invoker`, so the caller's rights and RLS apply; application functions are `SECURITY INVOKER`; `SECURITY DEFINER` is reserved for a very small audited set of framework functions (`chromatis.has_role`).

## 17. Authentication

Authentication produces a persistent Chromatis User. Login state is an **Auth Session**: an opaque, database-backed row identified by a random id in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. A request is resolved from cookie to session to User before module code runs, and module code receives a frozen per-request context. The mechanism is identical on Bun and Cloudflare. An Auth Session is distinct from a Stateful Runtime instance and from any product-level session concept.

Single sign-on uses a provider-neutral contract with OIDC/PKCE, state and nonce handling, one-time callbacks, ID-token validation and a framework-owned external-identity mapping; products supply provider adapters. See [docs/authentication.md](docs/authentication.md).

## 18. Stateful Runtime

The Stateful Runtime is a generic abstraction for temporary, addressable, coordinated state: a Runtime Instance has an identity, holds state for its lifetime, processes commands and messages serially, coordinates realtime connections and can close. Chromatis never interprets the state or the messages. The runtime exists so product modules can use the same realtime domain logic on both targets without importing platform APIs.

Two hosts implement the contract: the Bun host keeps instances in process memory; the Cloudflare host runs each instance as a Durable Object and keeps Cloudflare APIs private. Both delegate to one shared instance implementation and satisfy the same contract suite, which also runs against the Cloudflare code inside workerd. It is not long-term persistence and not an application-wide event bus. See [docs/stateful-runtime.md](docs/stateful-runtime.md).

## 19. Errors and logging

One typed error hierarchy (unauthenticated, permission denied, not found, conflict, validation) is mapped to HTTP responses by one request-level boundary; modules throw typed errors and never build framework error responses. Logging is structured JSON with request id, user id, module, level and message; a request id is created once and propagated. The default sink is the console on both targets.

## 20. Quality and security tooling

`check` standardizes TypeScript strict mode, ESLint with zero warnings, Prettier, architecture rules, configuration and artifact validation, database artifact consistency, security checks and tests. The database and security checks cover: RLS enabled and (where declared) forced on protected tables; the runtime role is neither owner, superuser nor `BYPASSRLS`; referenced roles exist; `user_column` and `through` relationships are valid and backed by foreign keys; access declarations match their generated migrations; views are `security_invoker`; functions are `SECURITY INVOKER`; no unauthorized `SECURITY DEFINER`; public access is explicit. `security describe` prints every table's effective access; `security audit` verifies a live database.

## 21. Testing

The default runner is Bun's. The platform tests cover unit and module behavior, PostgreSQL integration (against an ephemeral database, with positive and negative access cases), the Stateful Runtime contract on every host, React UI, and complete builds of a fixture application for both deployment targets including the dev server. Products test their configuration-dependent code with the preload and injection helpers in section 6.
