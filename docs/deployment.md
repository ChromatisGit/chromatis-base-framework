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

The server entry and the server's route tables are bundled with `Bun.build` into `.chromatis/image`, together with `build/client`, whose `index.html` the server returns for every page path; the image is built from the framework Dockerfile (`oven/bun`, runs as the `bun` user, exposes the configured port, health check on `/_chromatis/health`) by the generated `.chromatis/build/compose.json`. Embedded artifacts and configuration need no mounts. The compose service has a health check on `/_chromatis/health`, receives `PORT`, `PUBLIC_URL` and the secrets from `.chromatis/build/app.env` (mode 0600, git-ignored), and is started with `docker compose up --build -d`. The image contains no secret values.

## One image for many instances

A product can be released as **one Docker image** that many instances run, each with its own configuration, content and pages, and none with its own build. Two settings in `config/app.toml` make this work:

```toml
# The image itself (built by CI, never deployed by Chromatis):
[deployment]
target = "bun"
domain = "localhost"     # unused; PUBLIC_URL decides at runtime
instance = "mounted"
```

```toml
# An instance that runs on it:
[deployment]
target = "bun"
domain = "app.example.org"

[deployment.image]
name = "ghcr.io/org/app"
tag = "1.4.0"

[deployment.server]       # optional; without ssh the project starts here
ssh = "deploy@host"
path = "/srv/chromatis"   # the default
backup = "u1@u1.your-storagebox.de:app"   # optional, see Backups
```

**The mounted image.** `chromatis build` bundles `server.js`, `migrate.js` and the product's `bin` commands (into `bin/`, on the image's `PATH`: `docker compose exec app <command>`) into `.chromatis/image` with the client build and the product's `src/modules/*/{migrations,sql}`; the image sets `CHROMATIS_APPLICATION_ROOT=/app`, which wins over the `applicationRoot` code derives from its own location, so the server and `migrate.js` find those migrations; `docker build -f infra/deploy/Dockerfile .chromatis/image` makes the image. Module configuration and artifacts are not embedded. At startup the server reads them from `CHROMATIS_INSTANCE` (default `/instance`):

| Path                         | Read as                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `config/<module>.toml`       | that module's configuration, validated with its schema (`production` overlays apply) |
| `artifacts/<artifact path>/` | that artifact, checked with its validator                                            |
| `site/`                      | not read by the app; Caddy serves it in front (below)                                |

An invalid or missing part stops the server before it listens, with every finding. `PUBLIC_URL` gives the address. The image has no `config/<module>.toml` of its own, and prerenders no pages. The browser bundle never contains `chromatis-config` or `chromatis-artifacts`, in any build.

**An instance on the image.** `chromatis build` runs its contributions, builds and prerenders its client as usual, and exports `.chromatis/mount/`: the config files of its modules, its artifacts and `site/`, which holds the prerendered pages and the client build's other files (assets, public files). Links on these pages load documents, so a visitor moves from the site into the app with a full page load. Its module set should match the image's (`[modules] disabled`), since the image decides which modules run.

`chromatis deploy` then writes `.chromatis/deploy/`: the framework's compose project (`infra/deploy`), `.env` (image, domain, database passwords, backup target; mode 0600), `app.env` (the app's secrets) and the mount as `instance/`. Without `ssh` it runs `docker compose pull --policy missing && docker compose up -d` there; with `ssh` it copies the directory with `rsync` (keeping the server's `backups/`) and runs the same over SSH. The smoke test asks `https://<domain>/_chromatis/health` (`HTTPS_PORT` set: that port; `localhost`: Caddy's own certificate is accepted). An image deployment needs `POSTGRES_PASSWORD`, `DATABASE_OWNER_PASSWORD`, `DATABASE_AUTH_PASSWORD` and `DATABASE_RUNTIME_PASSWORD` (hex, 32+ characters: they go into URLs) instead of the `DATABASE_*_URL` secrets, which compose derives. Migrations run in the project's `migrate` service, not from this machine.

Versions are tags and never change. Deploy a release: set `tag`, `chromatis deploy`. Roll back: the previous `tag`, `chromatis deploy`; or on the server, `IMAGE` in `.env` back and `docker compose up -d`. A deploy ends running Stateful Runtime sessions, so deploy outside lesson time.

### The compose project

`infra/deploy/compose.yaml`, usable without Chromatis (fill in `env.example` as `.env`):

- `app`: the image, `TRUST_PROXY=1` (Caddy is the only client), the mount read-only at `/instance`, the `files` volume at `/files`, `DATABASE_POOL_SIZE` (default 5 per pool), `nofile` 65536.
- `migrate`: the same image running `migrate.js`; the app starts after it succeeded.
- `db`: PostgreSQL 17 on the named volume `db`; `postgres/init-roles.sh` creates the three roles and the database `app` on the first start.
- `caddy`: TLS with automatic certificates for `DOMAIN`, no access log. `/files/*` comes from the `files` volume with `Cache-Control: immutable`; a path with a file in `instance/site` (`/x` as `x.html`, `/` as `index.html`, `/assets/*` immutable) comes from there; everything else, WebSockets included, goes to the app.

### Backups

`backup.sh` (in the project directory, e.g. daily from cron) writes `backups/<UTC time>/` with `app.dump` (`pg_dump --create`, so grants come back too), `files.tar.gz`, `instance.tar.gz` and `SHA256SUMS`, keeps the newest `BACKUP_KEEP` (14), and copies `backups/` to `BACKUP_TARGET` with `rsync` when set. For a Hetzner Storage Box use SSH port 23 through `~/.ssh/config`. `restore.sh backups/<time> [--instance]` checks the sums, stops app and Caddy, replaces the database and the files volume, and starts everything. On a new server deploy once with the same secrets (the init script creates the roles), copy the backup back into `backups/`, then restore.

## Database

When a module declares `database`, deploy applies pending migrations with `DATABASE_MIGRATION_URL` before uploading anything else; the running application uses `DATABASE_URL` only and refuses to start while the schema is behind. Provision the three PostgreSQL roles first (see the README and [SECURITY.md](SECURITY.md)). The migration and security tools read `src/modules/*` of the product package, so the package must ship those directories.
