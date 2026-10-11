/**
 * Bun test preload: makes `chromatis-config` and `chromatis-artifacts`
 * importable as live views of the values given to `injectChromatis` (empty by
 * default), so unit tests never depend on a built instance.
 */
import { plugin } from "bun";
import { INJECTED_KEY, type InjectedChromatis } from "./testing.js";

const APP_DEFAULTS = {
  name: "test",
  domain: "localhost",
  publicUrl: "http://localhost:3000",
  environment: "test",
};

function injected(): InjectedChromatis {
  return (
    (globalThis as Record<symbol, InjectedChromatis | undefined>)[
      INJECTED_KEY
    ] ?? {}
  );
}

/** A record whose entries are read from the injected values on every access. */
function liveRecord(
  read: () => Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return new Proxy<Record<string, unknown>>(
    {},
    {
      get: (_, key) => (typeof key === "symbol" ? undefined : read()[key]),
      has: (_, key) => key in read(),
      ownKeys: () => Reflect.ownKeys(read()),
      getOwnPropertyDescriptor: (_, key) => {
        const value = (read() as Record<string | symbol, unknown>)[key];
        return value === undefined
          ? undefined
          : { enumerable: true, configurable: true, value };
      },
    },
  );
}

plugin({
  name: "chromatis-test-virtual-modules",
  setup(builder) {
    builder.module("chromatis-config", () => ({
      exports: {
        config: liveRecord(() => injected().config ?? {}),
        app: liveRecord(() => ({ ...APP_DEFAULTS, ...injected().app })),
      },
      loader: "object",
    }));
    builder.module("chromatis-artifacts", () => ({
      exports: { artifacts: liveRecord(() => injected().artifacts ?? {}) },
      loader: "object",
    }));
  },
});
