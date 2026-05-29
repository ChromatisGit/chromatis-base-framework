import { fileURLToPath } from "node:url";
import path from "node:path";

import base from "./infra/eslint.config.base.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default [
  {
    ignores: [
      "node_modules/**",
      "demo-app/build/**",
      "demo-app/.react-router/**",
      "src/**/.client/**",
      "src/**/.server/**",
    ],
  },
  ...base,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["infra/scripts/*.ts", "infra/*.d.ts"],
        },
        tsconfigRootDir: __dirname,
      },
    },
  },
  {
    files: ["eslint.config.js", "infra/**/*.js"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: ["infra/**/*.{ts,js}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
