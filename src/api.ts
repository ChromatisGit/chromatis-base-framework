/**
 * API endpoints: routes declared with `api: true`. Their file exports one
 * handler per HTTP method (`GET`, `POST`, ...); the framework calls them before,
 * and instead of, React Router, so an endpoint pays for nothing but its own work.
 */

export const API_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type ApiMethod = (typeof API_METHODS)[number];

export type ApiContext = Readonly<{
  request: Request;
  /** The `:name` segments of the path, decoded. */
  params: Readonly<Record<string, string>>;
}>;

export type ApiHandler = (context: ApiContext) => Response | Promise<Response>;

/** What an endpoint file exports. */
export type ApiModule = Partial<Record<ApiMethod, ApiHandler>>;

/** One endpoint as the build lists it: its URL path and its module. */
export type ApiEntry = Readonly<{ path: string; module: ApiModule }>;

type CompiledEntry = Readonly<{
  segments: readonly string[];
  module: ApiModule;
}>;

export type ApiTable = readonly CompiledEntry[];

/** `/a/:b/c` as segments; the order of `entries` decides between overlapping paths. */
export function compileApi(entries: readonly ApiEntry[]): ApiTable {
  return entries.map((entry) => ({
    segments: entry.path.split("/").filter(Boolean),
    module: entry.module,
  }));
}

/** The endpoint for `pathname` and its parameters, or undefined. */
export function matchApi(
  table: ApiTable,
  pathname: string,
): { module: ApiModule; params: Readonly<Record<string, string>> } | undefined {
  const parts = pathname.split("/").filter(Boolean);
  for (const entry of table) {
    if (entry.segments.length !== parts.length) {
      continue;
    }
    const params: Record<string, string> = {};
    const matched = entry.segments.every((segment, index) => {
      const part = parts[index] ?? "";
      if (segment.startsWith(":")) {
        try {
          params[segment.slice(1)] = decodeURIComponent(part);
        } catch {
          return false;
        }
        return true;
      }
      return segment === part;
    });
    if (matched) {
      return { module: entry.module, params };
    }
  }
  return undefined;
}

/**
 * Answers `request` when an endpoint matches its path: with the method's
 * handler (HEAD falls back to GET), or 405 listing the methods it has.
 * Undefined when no endpoint matches.
 */
export async function handleApi(
  table: ApiTable,
  request: Request,
): Promise<Response | undefined> {
  const match = matchApi(table, new URL(request.url).pathname);
  if (!match) {
    return undefined;
  }
  const method = request.method === "HEAD" ? "GET" : request.method;
  const handler = match.module[method as ApiMethod];
  if (!handler) {
    const allowed = API_METHODS.filter((name) => match.module[name]);
    return new Response(null, {
      status: 405,
      headers: { Allow: allowed.join(", ") },
    });
  }
  try {
    return await handler({ request, params: match.params });
  } catch (error) {
    // Handlers may throw a Response, as React Router loaders do.
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }
}
