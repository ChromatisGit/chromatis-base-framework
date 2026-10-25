import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DATA_CACHE,
  DATA_PREFIX,
  DOCUMENT_HEADER,
  OFFLINE_HEADER,
  ROUTES_PARAM,
  SERVICE_WORKER_PATH,
} from "../../src/data-protocol.js";
import type { ResolvedApplication } from "./resolvedApplication.js";

const CLIENT = "build/client";
const TEMPLATE = path.resolve(import.meta.dir, "../../src/service-worker.js");

/**
 * The build's files a version caches when it installs: scripts, styles and
 * WOFF2 fonts. WOFF files are fallbacks for browsers without WOFF2, and
 * those have no service worker either.
 */
const PRECACHED = /\.(js|css|woff2)$/;

export type ServiceWorkerConfig = Readonly<{
  version: string;
  shell: string;
  precache: readonly string[];
  immutable: readonly string[];
  dataPrefix: string;
  routesParam: string;
  dataCache: string;
  documentHeader: string;
  offlineHeader: string;
}>;

/** What the service worker of a client build knows; its version is their hash. */
export function serviceWorkerConfig(
  client: string,
  immutable: readonly string[],
): ServiceWorkerConfig {
  const assets = path.join(client, "assets");
  const precache = existsSync(assets)
    ? readdirSync(assets)
        .filter((file) => PRECACHED.test(file))
        .sort()
        .map((file) => `/assets/${file}`)
    : [];
  const shell = readFileSync(path.join(client, "index.html"), "utf8");
  const version = createHash("sha256")
    .update(JSON.stringify({ shell, precache, immutable }))
    .digest("hex")
    .slice(0, 16);
  return {
    version,
    shell,
    precache,
    immutable,
    dataPrefix: DATA_PREFIX,
    routesParam: ROUTES_PARAM,
    dataCache: DATA_CACHE,
    documentHeader: DOCUMENT_HEADER,
    offlineHeader: OFFLINE_HEADER,
  };
}

export const serviceWorkerSource = (config: ServiceWorkerConfig): string =>
  `const CONFIG = ${JSON.stringify(config)};\n${readFileSync(TEMPLATE, "utf8")}`;

/**
 * Writes `sw.js` into the client build of an app whose document asks for
 * one. An instance on an image has none: the image's server is the app, and
 * its service worker covers the static pages in front of it.
 */
export function writeServiceWorker(
  root: string,
  app: ResolvedApplication,
): string | undefined {
  const options = app.shell.document?.serviceWorker;
  if (!options || app.image) {
    return undefined;
  }
  const client = path.join(root, CLIENT);
  const config = serviceWorkerConfig(client, options.immutable);
  writeFileSync(
    path.join(client, SERVICE_WORKER_PATH.slice(1)),
    serviceWorkerSource(config),
  );
  return config.version;
}
