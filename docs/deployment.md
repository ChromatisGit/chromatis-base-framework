# Deploying an instance

`chromatis deploy` takes an instance from configuration to a running application on Cloudflare or a Bun server in Docker. The design is in [ARCHITECTURE.md](../ARCHITECTURE.md); this page is the operating guide. For a step-by-step Cloudflare setup (account, API token) see [cloudflare-deployment.md](cloudflare-deployment.md).

## Choosing the target

`config/app.toml` decides:

```toml
[deployment]
target = "cloudflare"   # or "bun"
domain = "app.example.org"
```

`--target cloudflare|bun|docker` overrides it for one command (`bun` and `docker` are the same Bun server build). The domain must be the real public host name before a live Cloudflare deploy; the preflight rejects `example.com` and `localhost` for Cloudflare. The application name (Worker name, secret service, image name) is the package name without scope unless `[deployment] name` is set; keep it stable, because renaming a Worker creates a new one.

## What `chromatis deploy` does

1. Runs the instance's own `check` script (`bun run check`) unless `--dry-run`.
2. Runs build contributions and validates artifacts (the same steps as `chromatis build`).
3. Asks for the Cloudflare credentials if they are missing (Cloudflare target, not dry run, not offline).
4. Preflight, first part: everything that does not need the build output.
5. Builds the application with the exact validated artifacts embedded.
6. Preflight, second part: build output, artifacts still match the embedding, Wrangler accepts the generated configuration (`wrangler deploy --dry-run`).
7. Prints the plan: target, name, public URL, runtime bindings, Durable Object migration tags, variable and secret names (never values), contributions and artifacts.
8. With `--dry-run` it stops here (the Docker target also writes its compose files). Otherwise it applies database migrations when a module uses PostgreSQL, uploads secrets (Cloudflare) or writes the env file (Docker), deploys, and runs the smoke test.

`--offline` limits the preflight to checks that need neither secrets nor network; a dry run without it still reads the Cloudflare API but changes nothing.

## Preflight

Every failure is listed in one message so they can be fixed together:

- tooling files and generated files are current (`chromatis init`);
- every declared artifact exists and passes its validator, and the build embeds the current artifact;
- the server hook loads and its definitions equal the declared runtime kinds;
- the Durable Object migration ledger is consistent;
- for modules that use PostgreSQL: generated-migration and access-rule checks, and a connection with the runtime credential (pending migrations are reported, since deploy applies them);
- every secret required for the environment is set, naming the missing ones;
- Cloudflare: a real domain, Wrangler installed, credentials valid, generated configuration accepted; Docker: a reachable Docker daemon.

`chromatis doctor` runs the same preflight against the current build output and prints the instance diagnostics first; `doctor --json` returns both as JSON.

## Secrets

Required secrets are those the active modules declare (`always`, plus `production` ones when the environment is production) and, for modules that use PostgreSQL, `DATABASE_URL` and `DATABASE_MIGRATION_URL`. Set them with `chromatis secret`, or provide them as environment variables (for CI, or in Bun's git-ignored `.env.local`); the environment wins over the credential store. Cloudflare credentials (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) use the reserved service `dev.chromatis.framework`; application secrets use `dev.chromatis.<application name>`. Wrangler receives credentials only in its child-process environment and secret values through standard input. The migration credential is used only to apply migrations and is not uploaded.

## Cloudflare mechanics

Chromatis writes `.chromatis/build/wrangler.json` (name, entry, compatibility settings, `PUBLIC_URL`, Durable Object bindings and migrations) and builds with the Cloudflare Vite plugin, which emits the deployable `build/server/wrangler.json`. For each Stateful Runtime kind the Worker exports a Durable Object class; the committed ledger `.chromatis/runtime-migrations.json` records class additions and deletions as appended tags (`v1`, `v2`, …) and is never edited by hand. A renamed kind deletes the old class and adds a new one; in-memory instances are not carried over. Review and commit a new ledger entry before deploying. The smoke test requests the public URL; if that fails it resolves the Worker's `workers.dev` URL and warns that the custom domain still has to be attached in Cloudflare.

The Worker renders no pages. The generated assets configuration serves `index.html` for every path without a file (`not_found_handling: single-page-application`) and hands only `/_chromatis/*` and the API endpoints' paths to the Worker first (`run_worker_first`). A product's `_headers` file (in its `app.public` directory or the instance's `public/`) sets the static files' headers.

## Bun / Docker mechanics

The server entry and the server's route tables are bundled with `Bun.build` into `.chromatis/image`, together with `build/client`, whose `index.html` the server returns for every page path; the image is built from the framework Dockerfile (`oven/bun`, runs as the `bun` user, exposes the configured port) by the generated `.chromatis/build/compose.json`. Embedded artifacts and configuration need no mounts. The compose service has a health check on `/_chromatis/health`, receives `PORT`, `PUBLIC_URL` and the secrets from `.chromatis/build/app.env` (mode 0600, git-ignored), and is started with `docker compose up --build -d`. The image contains no secret values.

## Database

When a module declares `database`, deploy applies pending migrations with `DATABASE_MIGRATION_URL` before uploading anything else; the running application uses `DATABASE_URL` only and refuses to start while the schema is behind. Provision the three PostgreSQL roles first (see the README and [SECURITY.md](SECURITY.md)). The migration and security tools read `src/modules/*` of the product package, so the package must ship those directories.
