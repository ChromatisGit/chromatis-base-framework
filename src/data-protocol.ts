/**
 * How the browser router and the server exchange the results of server
 * `loader`s and `action`s (see data.ts and client.tsx). One GET loads every
 * server loader a navigation needs, so a page costs the Worker one request.
 */

/** Prefix of the data endpoint; the page's path follows it. */
export const DATA_PREFIX = "/_chromatis/data";
/** Query parameter: the comma-separated route ids whose loaders to run. */
export const ROUTES_PARAM = "_routes";
/** Query parameter: the route id whose action to run. */
export const ROUTE_PARAM = "_route";

/** What a prerendered page leaves for the browser (`window.__chromatisPrerender`). */
export type Prerendered = Readonly<{
  path: string;
  /** React Router's hydration data: the loaders' results at build time. */
  hydrationData: Readonly<{ loaderData: Readonly<Record<string, unknown>> }>;
}>;

/**
 * Set on `<html>` while a prerendered `index.html` serves a path it was not
 * rendered for (the static fallback of every page); its CSS hides the markup.
 */
export const SHELL_ATTRIBUTE = "data-chromatis-shell";

/** A loader's or action's outcome for one route. */
export type DataResult =
  | Readonly<{ data: unknown; status?: number }>
  | Readonly<{
      error: Readonly<{ status: number; statusText?: string; data?: unknown }>;
    }>;

/** The body of a data response. */
export type DataResponse =
  | Readonly<{
      redirect: string;
      /**
       * Every loader runs again at the target: the redirect set a cookie, so
       * what the server knows about the visitor may have changed.
       */
      revalidate?: true;
      /** The browser loads the target as a new document (`redirectDocument`). */
      reload?: true;
    }>
  | Readonly<{ results: Readonly<Record<string, DataResult>> }>;

/** Where the service worker is served (`document.serviceWorker`). */
export const SERVICE_WORKER_PATH = "/sw.js";
/** Marks the server's answer with the app's document, as opposed to a static page. */
export const DOCUMENT_HEADER = "x-chromatis-document";
/** The service worker's kept data results; emptied when the visitor changes. */
export const DATA_CACHE = "chromatis-data";
/** Set on a data response the service worker put together without a network. */
export const OFFLINE_HEADER = "x-chromatis-offline";
/** Set on a data response that sets a cookie: the visitor's data changed. */
export const COOKIES_HEADER = "x-chromatis-cookies";
