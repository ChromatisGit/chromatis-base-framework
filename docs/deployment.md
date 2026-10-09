# Framework deployment

An application declares deployment settings in `chromatis.toml`. This follows the framework's existing TOML configuration convention. `bun run config` validates the declaration with Zod. The application supplies a server hook only when it needs a Stateful Runtime or realtime route.

```toml
name = "example"
publicUrl = "https://example.com"
target = "cloudflare"
postgresql = false
runtime = ["room"]
serverHook = "server/hook.ts"
secrets = ["PAYMENT_KEY"]
optionalSecrets = ["DIRECTORY_KEY"]

[variables]
DIRECTORY_URL = "https://directory.example.com"

[contentMounts]
catalog = "../content/builds/abc123"
```

`target` defaults to Cloudflare, `postgresql` to false, and `port` to 3000. `runtime` names must exactly match the `kind` values in the hook's definitions. The hook supplies `definitions`, `createService(host, env)`, and optionally `realtimeRoute`, `socket`, and `sweep`. A content mount is read only in Docker and appears at `/content/<name>/<source basename>`; the framework sets `CONTENT_<NAME>_DIR` to that path. The framework also generates `.chromatis/build/content.ts` with the mount's files for Worker builds. An application can import that generated module when it needs content in a Worker. The content directory must exist at build time.

## Commands

- `bun run init` repairs the canonical `tsconfig.json` and `eslint.config.js` stubs and adds ignores for generated files.
- `bun run check` and `bun run lint` reject byte changes to those stubs.
- `bun run build --target cloudflare|docker` builds with the framework Vite config.
- `bun run deploy --dry-run --target cloudflare|docker` builds and prints names, bindings, migrations, and variable and secret names without contacting either platform.
- `bun run doctor --target cloudflare|docker` checks the chosen target.
- `bun run deploy --target cloudflare|docker` checks, builds, applies database migrations only when declared, pushes secrets, deploys, and tests the page and realtime route.

Set `publicUrl` in `chromatis.toml` to the application's real URL before a live Cloudflare deploy. Example domains are accepted for offline builds and dry runs, but `doctor` rejects them for a live Cloudflare deploy.

React Router's installed CLI accepts `--config` for Vite. It searches the project root for `react-router.config.*`; the framework generates an ignored root file before building. The application does not keep either config file. Cloudflare build input is `.chromatis/build/wrangler.json`; the Vite plugin writes the deployable config with the actual asset path to `build/server/wrangler.json`. The Docker image input is `.chromatis/image` and the framework Dockerfile. All of these paths are ignored.

For Cloudflare builds, the framework briefly writes React Router's Web Streams server entry to `app/entry.server.tsx` and removes it after the build, including on failure. When a consumer route is a re-export from an installed package, the framework temporarily inlines that route's source so React Router can separate browser and server exports, then restores the original file.

## Secrets

Run `bun run secret` in an interactive terminal. It lists every secret the application defines (Cloudflare credentials, required and optional secrets) with whether it is defined; select one with the arrow keys to set, replace or remove it. Values are typed only into a masked prompt and go to the OS credential store, so they never appear in shell history; there are no `set` or `status` arguments. Cloudflare credentials use the reserved `dev.chromatis.framework` service. Application secrets use `dev.chromatis.<application name>`. Wrangler receives credentials only in its child process environment, and application secret values through stdin. Docker receives application secrets through `.chromatis/build/app.env` with mode `0600`; the image contains no secret values.

## Stateful Runtime migrations

The application commits `.chromatis-runtime-migrations.json`. On build, the framework compares the desired runtime class set with the classes recorded by the ledger. A change appends `v<N+1>` with sorted additions and deletions; it does not edit earlier entries. Rebuilding with the same definitions changes nothing. Review and commit the new ledger entry before deployment. A class rename deletes the old class and adds a new one; existing in-memory Runtime Instances are not preserved by this migration.

The Session Directory process is a separate deployable, outside this application deployment command. An application registers with it only when `DIRECTORY_URL`, `DIRECTORY_KEY`, and `PUBLIC_URL` are all present.
