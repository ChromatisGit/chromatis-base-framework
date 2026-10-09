// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import importPlugin from "eslint-plugin-import";
import architecture from "./eslint.architecture.js";

/**
 * Base ESLint config shared across all projects using this framework.
 * Extend in each project's eslint.config.js:
 *
 *   import base from "./.shared/infra/eslint.config.base.js";
 *   export default [...base, { rules: { ... } }];
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
      chromatis: architecture,
      import: importPlugin,
    },
    settings: {
      "import/resolver": {
        typescript: true,
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "off",

      // Application SQL: parameters only, no raw SQL, no identity manipulation
      "chromatis/no-raw-sql": "error",

      // Prefer type imports to keep the runtime bundle clean
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      // Catch unhandled promise rejections
      "@typescript-eslint/no-floating-promises": "error",

      // Disallow non-null assertions — use proper narrowing
      "@typescript-eslint/no-non-null-assertion": "error",

      // Allow _ prefix for intentionally unused vars
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      "chromatis/dependencies": "error",
      "chromatis/module-layout": "error",
      "import/no-cycle": "error",
      "no-console": ["error", { allow: ["log", "info", "warn", "error"] }],
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always"],
      curly: ["error", "all"],
      "no-param-reassign": "error",
      "max-lines": [
        "error",
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "error",
        { max: 100, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    // Relax some rules for config and script files
    files: ["*.config.*", "scripts/**/*", "infra/**/*"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
);
