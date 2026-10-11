import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { injectChromatis } from "./testing.js";

type Config = { config: Record<string, unknown>; app: Record<string, string> };
let virtual: Config;
let artifacts: Record<string, { basename: string }>;

beforeAll(async () => {
  await import("./test-preload.js");
  virtual = (await import("chromatis-config")) as unknown as Config;
  artifacts = (
    (await import("chromatis-artifacts")) as unknown as {
      artifacts: Record<string, { basename: string }>;
    }
  ).artifacts;
});

let restore = (): void => {};
afterEach(() => restore());

describe("test injection of the virtual modules", () => {
  test("defaults are empty config and a local test app", () => {
    expect(Object.keys(virtual.config)).toEqual([]);
    expect(virtual.app).toMatchObject({
      domain: "localhost",
      environment: "test",
    });
    expect(Object.keys(artifacts)).toEqual([]);
  });

  test("injected values are visible through bindings imported earlier", () => {
    restore = injectChromatis({
      config: { classroom: { joinWindowSeconds: 30 } },
      app: { publicUrl: "https://example.org" },
      artifacts: { catalog: { basename: "catalog", files: {} } },
    });
    expect(virtual.config.classroom).toEqual({ joinWindowSeconds: 30 });
    expect(Object.keys(virtual.config)).toEqual(["classroom"]);
    expect(virtual.app.publicUrl).toBe("https://example.org");
    expect(virtual.app.domain).toBe("localhost");
    expect(artifacts.catalog?.basename).toBe("catalog");
  });

  test("restore returns to the previous values", () => {
    const outer = injectChromatis({ config: { a: 1 } });
    const inner = injectChromatis({ config: { a: 2 } });
    expect(virtual.config.a).toBe(2);
    inner();
    expect(virtual.config.a).toBe(1);
    outer();
    expect(virtual.config.a).toBeUndefined();
  });
});
