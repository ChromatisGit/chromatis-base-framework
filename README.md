# @chromatis/base

Opinionated shared platform for React Router v7 apps. Provides shell components, UI primitives, forms, data views, auth, DB layer, routing helpers, offline support, and shared tooling config.

## Setup

Install as a git dependency — no registry needed:

```json
// your-app/package.json
{
  "dependencies": {
    "@chromatis/base": "git+https://github.com/ChromatisGit/personal-base-framework.git"
  }
}
```

Run `bun install` — Bun clones the repo and links it at `node_modules/@chromatis/base`.

To pull the latest version after the framework has been updated:

```sh
bun update @chromatis/base
```

`bun install` alone does not re-fetch git dependencies that are already present.

## Package exports

| Import path | What it provides |
|---|---|
| `@chromatis/base` | Shell, layouts, primitives, forms, data-view components, `defineRouteAction` |
| `@chromatis/base/component` | Low-level primitives (`cn`, `useBreakpoint`, `useReducedMotion`) for building custom components |
| `@chromatis/base/db` | `createDb`, `makeAnonSql`, `makeUserSql`, DB error types |
| `@chromatis/base/db-migrations` | Migration asset helpers |
| `@chromatis/base/runtime` | Runtime env helpers (`getRuntimeEnvVar`, `isCloudflareRuntime`, DB URL resolution) |
| `@chromatis/base/auth` | Session cookie, pin hashing, session service, route guard |
| `@chromatis/base/offline` | IndexedDB / offline sync utilities |
| `@chromatis/base/vite` | `createViteConfig()` — preconfigured Vite setup for React Router + Tailwind + Cloudflare |
| `@chromatis/base/styles` | Base CSS (import in `app.css`) |
| `@chromatis/base/infra/tsconfig` | Shared TypeScript compiler options |
| `@chromatis/base/infra/eslint` | Shared ESLint flat-config base |
| `@chromatis/base/infra/pwa/manifest` | Shared PWA manifest base JSON |

## Tooling config

### tsconfig.json

```json
{
  "extends": "@chromatis/base/infra/tsconfig",
  "compilerOptions": {
    "rootDirs": [".", "./.react-router/types"],
    "paths": {
      "@core/*": ["./src/core/*"],
      "@features/*": ["./src/features/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".react-router/types/**/*"],
  "exclude": ["node_modules", "build"]
}
```

### eslint.config.js

```js
import base from "@chromatis/base/infra/eslint";

export default [
  { ignores: ["node_modules/**", "build/**", ".react-router/**"] },
  ...base,
];
```

### vite.config.ts

```ts
import { createViteConfig } from "@chromatis/base/vite";

export default createViteConfig();
```

Or merge with app-specific plugins:

```ts
import { mergeConfig } from "vite";
import { createViteConfig } from "@chromatis/base/vite";

export default createViteConfig().then((config) =>
  mergeConfig(config, { /* app overrides */ })
);
```

### app.css

```css
@import "tailwindcss";
@import "@chromatis/base/styles";

@source "../src/**/*.{ts,tsx}";
@source "../node_modules/@chromatis/base/src/**/*.{ts,tsx}";
```

## Infra scripts

All scripts read configuration from `CONFIG.yaml` in the consuming project root. Copy `CONFIG.template.yaml` to `CONFIG.yaml` and fill in your values before running any script.

Scripts available after `bun install`:

| Script | Description |
|--------|-------------|
| `infra/scripts/devServer.ts` | Start dev server with env vars injected from `CONFIG.yaml` local profile |
| `infra/scripts/cfDev.ts` | Write `.dev.vars` from local profile and start Wrangler |
| `infra/scripts/cfDeploy.ts` | Sync production profile to Cloudflare secrets, build, deploy |
| `infra/scripts/db.ts` | Start Docker + apply pending migrations locally |
| `infra/scripts/dbReset.ts` | Wipe and reinitialize local database (refused if URL is not localhost) |
| `infra/scripts/dbDeploy.ts` | Show pending migrations, confirm, apply to production database |
| `infra/scripts/checkArchitectureBoundaries.ts` | Enforce layer import rules |

Typical `package.json` scripts in a consuming app:

```json
{
  "scripts": {
    "dev":       "bun run node_modules/@chromatis/base/infra/scripts/devServer.ts",
    "check":     "react-router typegen && tsc --noEmit && eslint . && bun run node_modules/@chromatis/base/infra/scripts/checkArchitectureBoundaries.ts",
    "build":     "react-router build",
    "start":     "node build/server/index.js",
    "db":        "bun run node_modules/@chromatis/base/infra/scripts/db.ts",
    "db:reset":  "bun run node_modules/@chromatis/base/infra/scripts/dbReset.ts",
    "db:deploy": "bun run node_modules/@chromatis/base/infra/scripts/dbDeploy.ts",
    "cf:dev":    "bun run node_modules/@chromatis/base/infra/scripts/cfDev.ts",
    "cf:deploy": "bun run node_modules/@chromatis/base/infra/scripts/cfDeploy.ts"
  }
}
```

## Docker

The shared Dockerfile is at `infra/docker/Dockerfile`. Build a consuming app with:

```sh
bun install
bun run build
docker build -f node_modules/@chromatis/base/infra/docker/Dockerfile -t my-app .
```

## Architecture rules

The architecture boundary checker enforces:

- **platform** — no imports from app code
- **core** — no imports from feature code
- **feature A** — no imports from feature B
