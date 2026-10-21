import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  routeDeclarationSchema,
  type RouteDeclaration,
} from "../../src/route-declaration.js";
import type { ManifestDiscovery, LoadedModule } from "./manifestDiscovery.js";
import { resolveSpecifier } from "./manifestDiscovery.js";
import type { Problem } from "./problems.js";
import type {
  ResolvedFile,
  ResolvedRoute,
  ResolvedShell,
} from "./resolvedApplication.js";

const EXTENSION = /\.[cm]?[jt]sx?$/;

/** Default route id: `routes/<file name without extension>`. */
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
): ResolvedFile {
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
    const resolve = (specifier: string): ResolvedFile | undefined => {
      try {
        return resolveFile(specifier, origin, discovery, root);
      } catch (error) {
        problems.push({
          source: `route ${id}`,
          key: origin.owner,
          message: `cannot resolve ${specifier}: ${error instanceof Error ? error.message : String(error)}`,
        });
        return undefined;
      }
    };
    const resolved = resolve(declaration.file);
    const server = declaration.server ? resolve(declaration.server) : undefined;
    if (!resolved || (declaration.server && !server)) {
      return [];
    }
    return [
      {
        id,
        owner: origin.owner,
        kind: declaration.api
          ? "api"
          : declaration.index
            ? "index"
            : declaration.layout
              ? "layout"
              : "route",
        path: declaration.path,
        ...resolved,
        server,
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
  /** How generated code imports the server file. */
  server: string | undefined;
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
        server: route.server?.from,
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
        const fix =
          key === "id"
            ? "; set an explicit id"
            : route.owner === "instance"
              ? "; list the path under [routes] omit in config/app.toml to replace it"
              : "";
        problems.push({
          source,
          message: `${label} "${value}" is declared by ${earlier.owner} (${earlier.file}) and ${route.owner} (${route.file})${fix}`,
        });
      }
      seen.set(value, route);
    }
  }
  return problems;
}

export const EXTRA_ROUTES_FILE = "app/routes.ts";
export const INSTANCE_ROOT_FILE = "app/root.tsx";
export const INSTANCE_ROOT_SERVER_FILE = "app/root.server.ts";

/**
 * The instance's own `app/routes.ts`, evaluated: a default exported list of
 * route declarations whose files are `./` paths relative to `app/`.
 */
export async function loadExtraRoutes(
  root: string,
): Promise<{ routes: RouteDeclaration[] | undefined; problems: Problem[] }> {
  const file = path.join(root, EXTRA_ROUTES_FILE);
  if (!existsSync(file)) {
    return { routes: undefined, problems: [] };
  }
  try {
    const loaded = (await import(pathToFileURL(file).href)) as {
      default?: unknown;
    };
    const parsed = z
      .array(routeDeclarationSchema)
      .safeParse(await loaded.default);
    if (!parsed.success) {
      throw new Error(
        `must default export a list of route declarations: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    return { routes: parsed.data, problems: [] };
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

/**
 * The application's root and routes: package-level ones first, then each
 * active module's (in module order), minus the paths the instance omits, then
 * the instance's own routes.
 */
export function resolveShell(input: {
  discovery: ManifestDiscovery;
  modules: readonly LoadedModule[];
  omit: readonly string[];
  root: string;
  extraRoutes?: readonly RouteDeclaration[] | undefined;
}): { shell: ResolvedShell; problems: Problem[] } {
  const { discovery, modules, root } = input;
  const problems: Problem[] = [];
  const app = discovery.manifest.app;
  const packageOrigin: Origin = {
    owner: "app",
    directory: path.dirname(discovery.manifestFile),
  };
  const resolveRoot = (specifier: string | undefined, key: string) => {
    if (!specifier) {
      return undefined;
    }
    try {
      return resolveFile(specifier, packageOrigin, discovery, root);
    } catch (error) {
      problems.push({
        source: key,
        key: "app",
        message: `cannot resolve ${specifier}: ${error instanceof Error ? error.message : String(error)}`,
      });
      return undefined;
    }
  };
  const ownRoot = path.join(root, INSTANCE_ROOT_FILE);
  const ownServer = path.join(root, INSTANCE_ROOT_SERVER_FILE);
  const own = existsSync(ownRoot);
  const shellRoot = own
    ? { from: withoutExtension(ownRoot), file: ownRoot }
    : resolveRoot(app?.root, "root");
  const rootServer = own
    ? existsSync(ownServer)
      ? { from: withoutExtension(ownServer), file: ownServer }
      : undefined
    : resolveRoot(app?.server, "root server");
  const product = [
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
  const kept = omitRoutes(product, new Set(input.omit), found);
  for (const entry of input.omit) {
    if (!found.has(entry)) {
      problems.push({
        source: "config/app.toml",
        key: "routes.omit",
        message: `no product route has the path "${entry}"`,
      });
    }
  }
  const extra = resolveTree(
    input.extraRoutes ?? [],
    { owner: "instance", directory: path.join(root, "app") },
    discovery,
    root,
    problems,
  );
  const routes = [...kept, ...extra];
  problems.push(...collisions(flattenRoutes(routes), "routes"));
  const publicDirectory = app?.public
    ? path.resolve(packageOrigin.directory ?? root, app.public)
    : undefined;
  if (
    publicDirectory &&
    !statSync(publicDirectory, { throwIfNoEntry: false })?.isDirectory()
  ) {
    problems.push({
      source: "public",
      key: "app",
      message: `${app?.public} is not a directory next to the manifest`,
    });
  }
  return {
    shell: {
      root: shellRoot,
      rootServer,
      rootSource: own ? "instance" : shellRoot ? "product" : "none",
      document: app?.document,
      publicDirectory,
      routes,
      omitted: input.omit,
    },
    problems,
  };
}
