import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStaticFiles } from "./server.js";

const root = mkdtempSync(path.join(tmpdir(), "chromatis-static-"));
mkdirSync(path.join(root, "assets"));
mkdirSync(path.join(root, "kurse"));
writeFileSync(path.join(root, "assets", "app-1a2b.js"), "app");
writeFileSync(path.join(root, "kurse", "mathe.html"), "<p>mathe</p>");
writeFileSync(path.join(root, "manifest.webmanifest"), "{}");
writeFileSync(path.join(root, "leer zeichen.txt"), "x");

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("createStaticFiles", () => {
  const serve = createStaticFiles(root);

  test("serves hashed assets as immutable", async () => {
    const response = serve("/assets/app-1a2b.js");
    expect(await response?.text()).toBe("app");
    expect(response?.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  test("serves prerendered pages without their extension", async () => {
    const response = serve("/kurse/mathe");
    expect(await response?.text()).toBe("<p>mathe</p>");
    expect(response?.headers.get("cache-control")).toBe("no-cache");
  });

  test("serves other public files with a short cache and decodes names", () => {
    expect(serve("/manifest.webmanifest")?.headers.get("cache-control")).toBe(
      "public, max-age=3600",
    );
    expect(serve("/leer%20zeichen.txt")).toBeDefined();
  });

  test("leaves directories, unknown and escaping paths to the caller", () => {
    for (const pathname of [
      "/",
      "/assets",
      "/kurse/",
      "/missing.js",
      "/%2e%2e/etc/passwd",
      "/assets/%2e%2e/%2e%2e/etc/passwd",
      "/%E0%A4%A",
    ]) {
      expect(serve(pathname)).toBeUndefined();
    }
  });

  test("a missing build directory serves nothing", () => {
    expect(
      createStaticFiles(path.join(root, "missing"))("/index.html"),
    ).toBeUndefined();
  });
});
