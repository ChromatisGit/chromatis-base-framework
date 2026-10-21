import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What one incoming request has already worked out. React Router hands every
 * loader of a request its own `Request` object, so a memo keyed on the request
 * never hits; the scope follows the request's async work instead.
 *
 * The storage lives on `globalThis` so a second copy of this module in a
 * bundle still shares it.
 */
type Scope = Map<string, unknown>;

const storageKey = Symbol.for("chromatis.request-scope");
const globals = globalThis as { [storageKey]?: AsyncLocalStorage<Scope> };
const storage = (globals[storageKey] ??= new AsyncLocalStorage<Scope>());

/** Runs `handle` with a fresh scope; the framework's servers call this. */
export function withRequestScope<T>(handle: () => T): T {
  return storage.run(new Map(), handle);
}

/**
 * The value `make` gives, computed once per request and key. Outside a request
 * scope (tests, the Vite development server) every call computes afresh.
 */
export function requestMemo<T>(key: string, make: () => T): T {
  const scope = storage.getStore();
  if (!scope) {
    return make();
  }
  if (!scope.has(key)) {
    scope.set(key, make());
  }
  return scope.get(key) as T;
}
