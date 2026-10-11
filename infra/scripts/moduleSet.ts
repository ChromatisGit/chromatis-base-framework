import { existsSync } from "node:fs";
import path from "node:path";
import type { LoadedModule } from "./manifestDiscovery.js";
import type { Problem } from "./problems.js";

export const ARTIFACTS_DIRECTORY = ".chromatis/artifacts";

export type SecretRequirement = "always" | "production";

export type DeclaredSecret = Readonly<{
  name: string;
  /** Declaring module, or `chromatis` for framework-derived secrets. */
  owner: string;
  description: string;
  requirement: SecretRequirement;
}>;

export type ArtifactRequirement = Readonly<{
  module: string;
  id: string;
  path: string;
  validator: Readonly<{ module: string; export: string }> | undefined;
  /** Id of the contribution that writes this path, if any. */
  producedBy: string | undefined;
  /** Present under `.chromatis/artifacts/` right now. */
  present: boolean;
}>;

export type ContributionDeclaration = Readonly<{
  module: string;
  id: string;
  specifier: string;
  export: string;
}>;

/** Secrets Chromatis itself needs because a module uses PostgreSQL. */
export const DATABASE_SECRETS: readonly DeclaredSecret[] = [
  {
    name: "DATABASE_MIGRATION_URL",
    owner: "chromatis",
    description: "PostgreSQL owner connection used to apply migrations",
    requirement: "always",
  },
  {
    name: "DATABASE_URL",
    owner: "chromatis",
    description: "PostgreSQL runtime connection",
    requirement: "always",
  },
];

export function declaredSecrets(
  modules: readonly LoadedModule[],
): DeclaredSecret[] {
  const own = modules.flatMap((module) =>
    module.declaration.secrets.map((secret) => ({
      name: secret.name,
      owner: module.name,
      description: secret.description,
      requirement: secret.required,
    })),
  );
  const database = modules.some((module) => module.declaration.database);
  return [...own, ...(database ? DATABASE_SECRETS : [])].sort((a, b) =>
    a.owner === b.owner
      ? a.name.localeCompare(b.name)
      : a.owner.localeCompare(b.owner),
  );
}

/** Secret names required or optional for `environment`. */
export function partitionSecrets(
  secrets: readonly DeclaredSecret[],
  environment: string,
): { required: string[]; optional: string[] } {
  const required = (secret: DeclaredSecret) =>
    secret.requirement === "always" ||
    (secret.requirement === "production" && environment === "production");
  return {
    required: secrets.filter(required).map((secret) => secret.name),
    optional: secrets
      .filter((secret) => !required(secret))
      .map((secret) => secret.name),
  };
}

export function contributionDeclarations(
  modules: readonly LoadedModule[],
): ContributionDeclaration[] {
  return modules
    .flatMap((module) =>
      module.declaration.contributions.map((contribution) => ({
        module: module.name,
        id: contribution.id,
        specifier: contribution.module,
        export: contribution.export,
      })),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function artifactRequirements(
  modules: readonly LoadedModule[],
  root: string,
): ArtifactRequirement[] {
  const contributions = contributionDeclarations(modules);
  return modules
    .flatMap((module) =>
      module.declaration.artifacts.map((artifact) => ({
        module: module.name,
        id: artifact.id,
        path: artifact.path,
        validator: artifact.validator,
        producedBy: contributions.find(
          (contribution) =>
            artifact.path === contribution.id ||
            artifact.path.startsWith(`${contribution.id}/`),
        )?.id,
        present: existsSync(
          path.join(root, ARTIFACTS_DIRECTORY, artifact.path),
        ),
      })),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

function duplicates(
  entries: readonly { owner: string; value: string }[],
): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const { owner, value } of entries) {
    owners.set(value, [...(owners.get(value) ?? []), owner]);
  }
  return new Map([...owners].filter(([, list]) => list.length > 1));
}

/** Rules that span modules; each module is validated on its own by defineModule. */
export function validateModuleSet(
  modules: readonly LoadedModule[],
  root: string,
): Problem[] {
  const problems: Problem[] = [];
  const collide = (
    what: string,
    entries: readonly { owner: string; value: string }[],
  ) => {
    for (const [value, owners] of duplicates(entries)) {
      problems.push({
        source: "modules",
        message: `${what} "${value}" is declared by ${owners.join(" and ")}`,
      });
    }
  };
  const each = <T>(select: (module: LoadedModule) => readonly T[]) =>
    modules.flatMap((module) =>
      select(module).map((item) => ({ module: module.name, item })),
    );

  collide(
    "runtime kind",
    each((m) => m.declaration.runtime).map(({ module, item }) => ({
      owner: module,
      value: item,
    })),
  );
  collide(
    "secret",
    each((m) => m.declaration.secrets).map(({ module, item }) => ({
      owner: module,
      value: item.name,
    })),
  );
  collide(
    "contribution id",
    each((m) => m.declaration.contributions).map(({ module, item }) => ({
      owner: module,
      value: item.id,
    })),
  );
  collide(
    "artifact id",
    each((m) => m.declaration.artifacts).map(({ module, item }) => ({
      owner: module,
      value: item.id,
    })),
  );
  collide(
    "artifact path",
    each((m) => m.declaration.artifacts).map(({ module, item }) => ({
      owner: module,
      value: item.path,
    })),
  );
  const hooks = modules.filter((module) => module.declaration.serverHook);
  if (hooks.length > 1) {
    problems.push({
      source: "modules",
      message: `only one module may declare a serverHook (Chromatis composes a single hook); declared by ${hooks.map((m) => m.name).join(" and ")}`,
    });
  }
  for (const artifact of artifactRequirements(modules, root)) {
    if (!artifact.producedBy && !artifact.present) {
      problems.push({
        source: `module ${artifact.module}`,
        key: `artifacts.${artifact.id}`,
        message: `no contribution produces ${artifact.path} and it is not present in ${ARTIFACTS_DIRECTORY}/`,
      });
    }
  }
  return problems;
}
