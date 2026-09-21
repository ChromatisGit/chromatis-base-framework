# @chromatis/base

Shared TypeScript source package for React Router applications. This repository is the framework code checkout. Project status, architecture direction, and candidate work are tracked in the ChromaCLI planning workspace; see its root `README.md` when working in the combined checkout.

## Current API

`package.json` defines the supported import paths. The main import exports UI shell, layouts, primitives, forms, data views, interaction components, and a route action helper. Separate paths expose `/component`, `/auth`, `/db`, `/db-migrations`, `/runtime`, `/schema`, `/sqlite`, `/sync`, `/offline`, `/vite`, `/styles`, and shared TypeScript, ESLint, and PWA config. SQLite and sync are still present pending an ownership review.

Consumers install this package as a Git dependency. The available StudyLuma checkout currently uses `personal-base-framework.git`, while this checkout's `origin` is `chromatis-base-framework.git`; confirm the canonical URL before changing a consumer dependency. To test local framework edits in a consumer, run `bun link` here and `bun link @chromatis/base` in the consumer. Check the consumer lockfile before committing after a link or update.

## Development

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
```

The package has no `test` script yet. `lint` and `typecheck` pass on the current `dev` checkout. The framework uses strict TypeScript, React Router 7, React 19, Vite 7, Tailwind 4, PostgreSQL, and SQLite WASM.

## Consumer tooling

The framework provides scripts under `infra/scripts/` for local development, Cloudflare development and deployment, PostgreSQL migrations, generated SQL routine checks, and the legacy `platform/core/features` boundary check. They operate from a consuming app and read its `CONFIG.yaml` local or production profile. A missing config can be created from that app's `CONFIG.template.yaml` if present.

Routine definitions in `sql/views/` and `sql/functions/` can be snapshotted by `dbGenerate.ts` into versioned migrations; `dbCheckGeneratedMigrations.ts` checks for drift. `dbReset.ts` is for a local database only. Review the target and config before using deployment or reset scripts.

The planned modular monolith layout and consolidated developer commands are not implemented in this package. Follow the code and `package.json` for the current API.
