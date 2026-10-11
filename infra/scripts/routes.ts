import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RouteDeclaration } from "../../src/route-declaration.js";
import type { ManifestDiscovery, LoadedModule } from "./manifestDiscovery.js";
import { resolveSpecifier } from "./manifestDiscovery.js";
import type { Problem } from "./problems.js";
import type { ResolvedRoute, ResolvedShell } from "./resolvedApplication.js";

const EXTENSION = /\.[cm]?[jt]sx?$/;

/** Default route id: `routes/<file name without extension>`, as in React Router. */
export const defaultRouteId = (file: string): string =>
  `routes/${path.posix.basename(file).replace(EXTENSION, "")}`;

/** Generated imports omit the extension: TypeScript rejects `.tsx` import paths. */
export const withoutExtension = (file: string): string =>
  file.replace(EXTENSION, "");

type Origin = Readonly<{ owner: string; directory: string | undefined }>;

function resolveFile(
  specifier: string,
  origin: Origin,
  discovery: ManifestDiscovery,
  root: string,
): { from: string; file: string } {
  if (specifier.startsWith(".") && origin.directory) {
    const file = Bun.resolveSync(specifier, origin.directory);
    return { from: withoutExtension(file), file };
  }
  const file = resolveSpecifier(specifier, discovery, root);
  return {
    from: specifier.startsWith(".") ? withoutExtension(file) : specifier,
    file,
  };
}

function resolveTree(
  declarations: readonly RouteDeclaration[],
  origin: Origin,
  discovery: ManifestDiscovery,
  root: string,
  problems: Problem[],
): ResolvedRoute[] {
  return declarations.flatMap((declaration): ResolvedRoute[] => {
    const id = declaration.id ?? defaultRouteId(declaration.file);
    let resolved: { from: string; file: string };
    try {
      resolved = resolveFile(declaration.file, origin, discovery, root);
    } catch (error) {
      problems.push({
        source: `route ${id}`,
        key: origin.owner,
        message: `cannot resolve ${declaration.file}: ${error instanceof Error ? error.message : String(error)}`,
      });
      return [];
    }
    return [
      {
        id,
        owner: origin.owner,
        kind: declaration.index
          ? "index"
          : declaration.layout
            ? "layout"
            : "route",
        path: declaration.path,
        ...resolved,
        children: resolveTree(
          declaration.children ?? [],
          origin,
          discovery,
          root,
          problems,
        ),
      },
    ];
  });
}

export type FlatRoute = Readonly<{
  id: string;
  owner: string;
  kind: ResolvedRoute["kind"];
  /** URL path (`/`, `/courses/:courseId`); undefined for layouts. */
  url: string | undefined;
  file: string;
}>;

const joinUrl = (parent: string, segment: string | undefined): string => {
  const parts = [parent, segment ?? ""].join("/").split("/").filter(Boolean);
  return `/${parts.join("/")}`;
};

/** Depth-first list of routes with their full URL paths. */
export function flattenRoutes(
  routes: readonly ResolvedRoute[],
  parent = "/",
): FlatRoute[] {
  return routes.flatMap((route) => {
    const url = route.kind === "layout" ? parent : joinUrl(parent, route.path);
    return [
      {
        id: route.id,
        owner: route.owner,
        kind: route.kind,
        url: route.kind === "layout" ? undefined : url,
        file: route.from,
      },
      ...flattenRoutes(route.children, url),
    ];
  });
}

function omitRoutes(
  routes: readonly ResolvedRoute[],
  omit: ReadonlySet<string>,
  found: Set<string>,
  parent = "/",
): ResolvedRoute[] {
  return routes.flatMap((route): ResolvedRoute[] => {
    const url = route.kind === "layout" ? parent : joinUrl(parent, route.path);
    if (route.kind !== "layout" && omit.has(url)) {
      found.add(url);
      return [];
    }
    return [
      { ...route, children: omitRoutes(route.children, omit, found, url) },
    ];
  });
}

function collisions(flat: readonly FlatRoute[], source: string): Problem[] {
  const problems: Problem[] = [];
  for (const [key, label] of [
    ["id", "route id"],
    ["url", "route path"],
  ] as const) {
    const seen = new Map<string, FlatRoute>();
    for (const route of flat) {
      const value = route[key];
      if (value === undefined) {
        continue;
      }
      const earlier = seen.get(value);
      if (earlier) {
        problems.push({
          source,
          message: `${label} "${value}" is declared by ${earlier.owner} (${earlier.file}) and ${route.owner} (${route.file})${key === "id" ? "; set an explicit id" : ""}`,
        });
      }
      seen.set(value, route);
    }
  }
  return problems;
}

/**
 * The product's root and routes: package-level ones first, then each active
 * module's (in module order), minus the paths the instance omits.
 */
export function resolveShell(input: {
  discovery: ManifestDiscovery;
  modules: readonly LoadedModule[];
  omit: readonly string[];
  root: string;
}): { shell: ResolvedShell; problems: Problem[] } {
  const { discovery, modules, root } = input;
  const problems: Problem[] = [];
  const app = discovery.manifest.app;
  const packageOrigin: Origin = {
    owner: "app",
    directory: path.dirname(discovery.manifestFile),
  };
  let shellRoot: ResolvedShell["root"];
  if (app?.root) {
    try {
      shellRoot = resolveFile(app.root, packageOrigin, discovery, root);
    } catch (error) {
      problems.push({
        source: "root",
        key: "app",
        message: `cannot resolve ${app.root}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  const all = [
    ...resolveTree(app?.routes ?? [], packageOrigin, discovery, root, problems),
    ...modules.flatMap((module) =>
      resolveTree(
        module.declaration.routes,
        { owner: module.name, directory: module.directory },
        discovery,
        root,
        problems,
      ),
    ),
  ];
  const found = new Set<string>();
  const routes = omitRoutes(all, new Set(input.omit), found);
  for (const entry of input.omit) {
    if (!found.has(entry)) {
      problems.push({
        source: "config/app.toml",
        key: "routes.omit",
        message: `no product route has the path "${entry}"`,
      });
    }
  }
  problems.push(...collisions(flattenRoutes(routes), "routes"));
  return {
    shell: { root: shellRoot, routes, omitted: input.omit },
    problems,
  };
}

/** React Router's route config entry, as `app/routes.ts` of an instance yields it. */
export type ExtraRoute = Readonly<{
  id?: string;
  path?: string;
  index?: boolean;
  file: string;
  children?: readonly ExtraRoute[];
}>;

export const EXTRA_ROUTES_FILE = "app/routes.ts";
export const INSTANCE_ROOT_FILE = "app/root.tsx";

/** The instance's own `app/routes.ts`, evaluated; undefined when it has none. */
export async function loadExtraRoutes(
  root: string,
): Promise<{ routes: ExtraRoute[] | undefined; problems: Problem[] }> {
  const file = path.join(root, EXTRA_ROUTES_FILE);
  if (!existsSync(file)) {
    return { routes: undefined, problems: [] };
  }
  try {
    const loaded = (await import(pathToFileURL(file).href)) as {
      default?: unknown;
    };
    const routes = await loaded.default;
    if (!Array.isArray(routes)) {
      throw new Error("must default export a RouteConfig (an array)");
    }
    return { routes: routes as ExtraRoute[], problems: [] };
  } catch (error) {
    return {
      routes: undefined,
      problems: [
        {
          source: EXTRA_ROUTES_FILE,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

export function flattenExtra(
  routes: readonly ExtraRoute[],
  parent = "/",
): FlatRoute[] {
  return routes.flatMap((route) => {
    const layout = !route.index && route.path === undefined;
    const url = layout ? parent : joinUrl(parent, route.path);
    return [
      {
        id: route.id ?? route.file.replace(EXTENSION, ""),
        owner: "instance",
        kind: route.index
          ? ("index" as const)
          : layout
            ? ("layout" as const)
            : ("route" as const),
        url: layout ? undefined : url,
        file: route.file,
      },
      ...flattenExtra(route.children ?? [], url),
    ];
  });
}

/** The instance's routes must not reuse a product route's id or path. */
export function extraRouteProblems(
  shell: ResolvedShell,
  extra: readonly ExtraRoute[],
): Problem[] {
  const product = flattenRoutes(shell.routes);
  const own = flattenExtra(extra);
  const problems: Problem[] = [];
  for (const route of own) {
    for (const [key, label] of [
      ["id", "route id"],
      ["url", "route path"],
    ] as const) {
      const value = route[key];
      const clash = product.find(
        (candidate) => value !== undefined && candidate[key] === value,
      );
      if (clash) {
        problems.push({
          source: EXTRA_ROUTES_FILE,
          message: `${label} "${value}" is already used by ${clash.owner} (${clash.file})${key === "url" ? "; list the path under [routes] omit in config/app.toml to replace it" : "; set an explicit id"}`,
        });
      }
    }
  }
  problems.push(...collisions(own, EXTRA_ROUTES_FILE));
  return problems;
}
