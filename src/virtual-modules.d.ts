/**
 * Types of the modules Chromatis generates for every instance. Load them with
 * `/// <reference types="@chromatis/base/virtual-modules" />` (and `export {};`
 * if the file has no other import or export) in one file of a product package;
 * the instance's generated tsconfig already includes them.
 */
declare module "chromatis-artifacts" {
  /** Files of one validated artifact: relative POSIX path to base64 content. */
  export interface ArtifactFiles {
    readonly basename: string;
    readonly files: Readonly<Record<string, string>>;
  }
  /** The artifacts the build embedded, by declared artifact id. */
  export const artifacts: Readonly<Record<string, ArtifactFiles>>;
}

declare module "chromatis-config" {
  /**
   * Validated, non-secret configuration of each module (`config/<module>.toml`
   * for the build environment), by module name. Read a typed value with
   * `moduleConfig(declaration, config)` from `@chromatis/base/module`.
   */
  export const config: Readonly<Record<string, unknown>>;
  /** Facts about the deployed application, from `config/app.toml`. */
  export const app: Readonly<{
    name: string;
    domain: string;
    publicUrl: string;
    environment: string;
  }>;
}
