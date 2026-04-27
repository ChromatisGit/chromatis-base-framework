// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

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
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

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

      // Console is fine in server code but warn to avoid accidental leaks
      "no-console": ["warn", { allow: ["warn", "error"] }],
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
