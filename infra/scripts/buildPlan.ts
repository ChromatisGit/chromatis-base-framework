import { resolveSpecifier } from "./manifestDiscovery.js";
import type { Instance } from "./instance.js";
import type {
  CodeReference,
  ResolvedArtifact,
  ResolvedAuthoredFiles,
  ResolvedContribution,
} from "./resolvedApplication.js";

export type BuildPlan = Readonly<{
  contributions: readonly ResolvedContribution[];
  artifacts: readonly ResolvedArtifact[];
  /** Editor tooling only; the build does not run these. */
  authoredFiles: readonly ResolvedAuthoredFiles[];
  moduleConfigs: Readonly<Record<string, unknown>>;
}>;

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * What the build must run and embed, from the module declarations. Module
 * specifiers are resolved here so a missing package is reported with the
 * contribution or artifact that needs it, when it is used.
 */
export function buildPlan(instance: Instance): BuildPlan {
  const { discovery, root } = instance;
  const reference = (specifier: string, exported: string): CodeReference => {
    if (!discovery) {
      return {
        specifier,
        export: exported,
        file: undefined,
        error: "no manifest",
      };
    }
    try {
      return {
        specifier,
        export: exported,
        file: resolveSpecifier(specifier, discovery, root),
        error: undefined,
      };
    } catch (error) {
      return {
        specifier,
        export: exported,
        file: undefined,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
  const declarations = instance.modules.map(({ module }) => module);
  return {
    contributions: declarations
      .flatMap((module) =>
        module.declaration.contributions.map((contribution) => ({
          id: contribution.id,
          owner: module.name,
          code: reference(contribution.module, contribution.export),
        })),
      )
      .sort(byId),
    artifacts: declarations
      .flatMap((module) =>
        module.declaration.artifacts.map((artifact) => ({
          id: artifact.id,
          owner: module.name,
          path: artifact.path,
          validator: artifact.validator
            ? reference(artifact.validator.module, artifact.validator.export)
            : undefined,
        })),
      )
      .sort(byId),
    authoredFiles: declarations.flatMap((module) =>
      module.declaration.authoredFiles.map((provider) => ({
        owner: module.name,
        code: reference(provider.module, provider.export),
      })),
    ),
    moduleConfigs: Object.fromEntries(
      instance.modules.flatMap(({ module, config }) =>
        config?.effective !== undefined
          ? [[module.name, config.effective]]
          : [],
      ),
    ),
  };
}
