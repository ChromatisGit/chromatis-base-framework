# @chromatis/base

Opinionated shared platform for React Router v7 apps. Provides shell components, UI primitives, forms, data views, auth, DB layer, routing helpers, offline support, and shared tooling config.

## Setup

This package is not published to npm. Consume it as a `file:` dependency from a sibling directory:

```json
// your-app/package.json
{
  "dependencies": {
    "@chromatis/base": "file:../chromatis-base"
  }
}
```

Run `bun install` — Bun creates a symlink at `node_modules/@chromatis/base`.

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

DB management scripts are available after `bun install` at:

```
node_modules/@chromatis/base/infra/scripts/dbDocker.ts
node_modules/@chromatis/base/infra/scripts/dbInit.ts
node_modules/@chromatis/base/infra/scripts/dbUpdate.ts
node_modules/@chromatis/base/infra/scripts/dbMigrations.ts
node_modules/@chromatis/base/infra/scripts/checkArchitectureBoundaries.ts
```

Typical `package.json` scripts in a consuming app:

```json
{
  "scripts": {
    "check:arch": "bun run node_modules/@chromatis/base/infra/scripts/checkArchitectureBoundaries.ts",
    "db:init": "bun run node_modules/@chromatis/base/infra/scripts/dbDocker.ts reset && bun run node_modules/@chromatis/base/infra/scripts/dbInit.ts",
    "db:update": "bun run node_modules/@chromatis/base/infra/scripts/dbDocker.ts start && bun run node_modules/@chromatis/base/infra/scripts/dbUpdate.ts"
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
