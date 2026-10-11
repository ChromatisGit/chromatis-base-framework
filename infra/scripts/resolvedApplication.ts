import type { ConfigEnvironment } from "../../src/config.js";
import type { DeclaredSecret } from "./moduleSet.js";

/** `docker` is the Bun server deployment (config target `bun`). */
export type BuildTarget = "cloudflare" | "docker";

/** An importable function declared by a module, resolved to a file. */
export type CodeReference = Readonly<{
  specifier: string;
  export: string;
  /** Absolute file, when the specifier resolved. */
  file: string | undefined;
  /** Why it did not resolve. */
  error: string | undefined;
}>;

export type ResolvedContribution = Readonly<{
  id: string;
  /** Declaring module. */
  owner: string;
  code: CodeReference;
}>;

/** Code that tells editors which schema the module's authored files follow. */
export type ResolvedAuthoredFiles = Readonly<{
  /** Declaring module. */
  owner: string;
  code: CodeReference;
}>;

export type ResolvedArtifact = Readonly<{
  id: string;
  owner: string;
  /** Relative to `.chromatis/artifacts/`. */
  path: string;
  validator: CodeReference | undefined;
}>;

/** A route of the product package after file resolution. */
export type ResolvedRoute = Readonly<{
  /** Unique across the application; the React Router route id. */
  id: string;
  /** Declaring module, or `app` for the package's own routes. */
  owner: string;
  kind: "route" | "index" | "layout";
  path: string | undefined;
  /** What a generated route file re-exports: a specifier, or an absolute path. */
  from: string;
  /** The resolved source file (its exports are read to write the re-export). */
  file: string;
  children: readonly ResolvedRoute[];
}>;

/** The application shell the product provides: root and routes. */
export type ResolvedShell = Readonly<{
  root: Readonly<{ from: string; file: string }> | undefined;
  routes: readonly ResolvedRoute[];
  /** Product route paths the instance replaces (`[routes] omit`). */
  omitted: readonly string[];
}>;

/**
 * Everything the build, dev and deploy commands need to know about an
 * instance, independent of where the facts were declared.
 */
export type ResolvedApplication = Readonly<{
  name: string;
  /** The instance directory. */
  instanceRoot: string;
  publicUrl: string;
  target: BuildTarget;
  port: number;
  environment: ConfigEnvironment;
  postgresql: boolean;
  /** Root of the code and database assets (`src/modules/*`): the product package. */
  packageRoot: string;
  /** Stateful Runtime kinds. */
  runtime: readonly string[];
  /** Absolute path of the server hook file. */
  serverHook: string | undefined;
  /** Required for `environment`. */
  secrets: readonly string[];
  optionalSecrets: readonly string[];
  /** Every declared secret, whatever the environment. */
  declaredSecrets: readonly DeclaredSecret[];
  /** Root and routes contributed by the product package and its active modules. */
  shell: ResolvedShell;
  /** Build contributions in execution order (sorted by id). */
  contributions: readonly ResolvedContribution[];
  /** Artifacts the build embeds, sorted by id. */
  artifacts: readonly ResolvedArtifact[];
  /** Validated module configuration for `environment`, keyed by module name. */
  moduleConfigs: Readonly<Record<string, unknown>>;
  /** Packages Vite must bundle for SSR instead of treating as external. */
  bundledPackages: readonly string[];
  /** Extra directories the dev server may read (linked packages). */
  allowedRoots: readonly string[];
}>;

export const targetFromConfig = (target: "cloudflare" | "bun"): BuildTarget =>
  target === "bun" ? "docker" : "cloudflare";
