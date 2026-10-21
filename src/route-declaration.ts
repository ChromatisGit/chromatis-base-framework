import { z } from "zod";

/**
 * A route as data, mirroring React Router's route config:
 *
 * - `{ path, file }` is a route (`route(path, file)`), optionally with `children`;
 * - `{ index: true, file }` is an index route;
 * - `{ layout: true, file, children }` is a pathless layout route;
 * - `{ path, api: true, file }` is an API endpoint: the file exports one handler
 *   per HTTP method (see `@chromatis/base/api`) and the browser router never
 *   sees it.
 *
 * A page's `file` runs in the browser: it default exports the component and may
 * export `ErrorBoundary`, `meta` and `handle`. Its `server` file runs only on the
 * server and exports `loader` and `action`; the browser fetches their results
 * (see `@chromatis/base/data`).
 *
 * `file` is a package-exported specifier (for example `@product/app/routes/home`)
 * or a `./` path relative to the declaring module's directory (for routes
 * declared at the top of the manifest: relative to the manifest file). The
 * default route id is `routes/<file name without extension>`; set `id` when the
 * same file serves two routes or the default would collide.
 */
export type RouteDeclaration = Readonly<{
  path?: string;
  index?: boolean;
  layout?: boolean;
  api?: boolean;
  id?: string;
  file: string;
  server?: string;
  children?: readonly RouteDeclaration[];
}>;

const routeId = z
  .string()
  .regex(/^[A-Za-z0-9][\w./-]*$/, { message: "must be a plain route id" })
  .refine((value) => !value.includes(".."), {
    message: "must not contain '..'",
  });

export const routeDeclarationSchema: z.ZodType<RouteDeclaration> = z.lazy(
  () =>
    z
      .object({
        path: z.string().min(1).optional(),
        index: z.literal(true).optional(),
        layout: z.literal(true).optional(),
        api: z.literal(true).optional(),
        id: routeId.optional(),
        file: z.string().regex(/^\S+$/, { message: "must be a specifier" }),
        server: z
          .string()
          .regex(/^\S+$/, { message: "must be a specifier" })
          .optional(),
        children: z.array(routeDeclarationSchema).optional(),
      })
      .strict()
      .superRefine((route, context) => {
        const kinds = [
          route.path !== undefined,
          route.index === true,
          route.layout === true,
        ].filter(Boolean).length;
        if (kinds !== 1) {
          context.addIssue({
            code: "custom",
            message: "set exactly one of path, index: true or layout: true",
          });
        }
        if (route.api && route.path === undefined) {
          context.addIssue({
            code: "custom",
            path: ["path"],
            message: "an API endpoint needs a path",
          });
        }
        if (route.api && route.server) {
          context.addIssue({
            code: "custom",
            path: ["server"],
            message: "an API endpoint is server code already; drop server",
          });
        }
        if (route.api && route.children) {
          context.addIssue({
            code: "custom",
            path: ["children"],
            message: "an API endpoint has no children",
          });
        }
        if (route.index && route.children) {
          context.addIssue({
            code: "custom",
            path: ["children"],
            message: "an index route has no children",
          });
        }
      }) as unknown as z.ZodType<RouteDeclaration>,
);

/** Every declared route, depth first, with its nesting. */
export function walkRoutes(
  routes: readonly RouteDeclaration[],
  visit: (
    route: RouteDeclaration,
    parents: readonly RouteDeclaration[],
  ) => void,
  parents: readonly RouteDeclaration[] = [],
): void {
  for (const route of routes) {
    visit(route, parents);
    walkRoutes(route.children ?? [], visit, [...parents, route]);
  }
}
