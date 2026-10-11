/**
 * Unit-test support for code that imports the generated `chromatis-config` and
 * `chromatis-artifacts` modules.
 *
 * Add `@chromatis/base/test-preload` to `[test] preload` in bunfig.toml, then
 * inject values around the code under test:
 *
 *   const restore = injectChromatis({ config: { classroom: { ... } } });
 *   // ... exercise code that reads config["classroom"] ...
 *   restore();
 */
export type TestArtifact = Readonly<{
  basename: string;
  files: Readonly<Record<string, string>>;
}>;

export type TestApp = Readonly<{
  name: string;
  domain: string;
  publicUrl: string;
  environment: string;
}>;

export type InjectedChromatis = Readonly<{
  /** Module configuration by module name, as `chromatis-config` exports it. */
  config?: Readonly<Record<string, unknown>>;
  app?: Partial<TestApp>;
  artifacts?: Readonly<Record<string, TestArtifact>>;
}>;

/** Where the preload's virtual modules look; shared by symbol, not by import. */
export const INJECTED_KEY = Symbol.for("chromatis.test.injected");

/** Replaces the injected values; the returned function restores the previous ones. */
export function injectChromatis(values: InjectedChromatis): () => void {
  const store = globalThis as Record<symbol, unknown>;
  const previous = store[INJECTED_KEY];
  store[INJECTED_KEY] = values;
  return () => {
    store[INJECTED_KEY] = previous;
  };
}
