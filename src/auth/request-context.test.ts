import { expect, test } from "bun:test";
import type { Database } from "../db/client.js";
import { requireUser, withAuthentication } from "./request-context.js";
import { createSessionManager } from "./session.server.js";
import type { SessionManager } from "./session.server.js";
import type { Session } from "./types.js";

const userA = "00000000-0000-4000-8000-000000000001";
const userB = "00000000-0000-4000-8000-000000000002";
const sessionA = "10000000-0000-4000-8000-000000000001";

function fakeManager(
  resolve: SessionManager["resolve"],
): Pick<SessionManager, "resolve"> {
  return { resolve };
}

test("authentication resolves once before the wrapped handler", async () => {
  const events: string[] = [];
  const session: Session = {
    id: sessionA,
    user: { id: userA },
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  };
  const handler = withAuthentication(
    fakeManager(async () => {
      events.push("resolve");
      return session;
    }),
    async (_request, context) => {
      events.push("handler");
      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.isFrozen(context.session)).toBe(true);
      context.session?.expiresAt.setTime(0);
      expect(context.session?.expiresAt.toISOString()).toBe(
        "2030-01-01T00:00:00.000Z",
      );
      expect(requireUser(context)).toEqual({ id: userA });
      expect(requireUser(context)).toEqual({ id: userA });
      return new Response("ok");
    },
  );

  expect(await (await handler(new Request("https://app.test"))).text()).toBe(
    "ok",
  );
  expect(events).toEqual(["resolve", "handler"]);
});

test("missing sessions are represented as immutable unauthenticated context", async () => {
  const handler = withAuthentication(
    fakeManager(async () => null),
    async (_, context) => {
      expect(context).toEqual({ session: null });
      expect(Object.isFrozen(context)).toBe(true);
      expect(() => requireUser(context)).toThrow("Authentication required");
      return new Response(null, { status: 204 });
    },
  );

  expect((await handler(new Request("https://app.test"))).status).toBe(204);
});

test("concurrent authenticated requests cannot leak identity", async () => {
  const sessions = new Map<string, Session>([
    [
      "a",
      {
        id: sessionA,
        user: { id: userA },
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    ],
    [
      "b",
      {
        id: "10000000-0000-4000-8000-000000000002",
        user: { id: userB },
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    ],
  ]);
  const handler = withAuthentication(
    fakeManager(async (request) => {
      const key = new URL(request.url).searchParams.get("request") ?? "";
      await Bun.sleep(key === "a" ? 10 : 1);
      return sessions.get(key) ?? null;
    }),
    async (request, context) => {
      await Bun.sleep(
        new URL(request.url).searchParams.get("request") === "a" ? 1 : 10,
      );
      return new Response(requireUser(context).id);
    },
  );

  const [a, b] = await Promise.all([
    handler(new Request("https://app.test/?request=a")),
    handler(new Request("https://app.test/?request=b")),
  ]);
  expect(await a.text()).toBe(userA);
  expect(await b.text()).toBe(userB);
});

test("the middleware uses the same Fetch request interface for both runtimes", async () => {
  const handler = withAuthentication(
    fakeManager(async (request) =>
      request.headers.get("cookie") === `sid=${sessionA}`
        ? {
            id: sessionA,
            user: { id: userA },
            expiresAt: new Date("2030-01-01T00:00:00.000Z"),
          }
        : null,
    ),
    async (_, context) => new Response(requireUser(context).id),
  );

  for (const runtime of ["bun", "cloudflare"] as const) {
    const request = new Request(`https://${runtime}.app.test`, {
      headers: { cookie: `sid=${sessionA}` },
    });
    expect(await (await handler(request)).text()).toBe(userA);
  }
});

test("missing and malformed session cookies are unauthenticated without querying PostgreSQL", async () => {
  const database = {
    anonTransaction() {
      throw new Error("malformed cookie must not reach the database");
    },
  } as unknown as Database;
  const manager = createSessionManager({ database, cookieName: "sid" });

  expect(await manager.resolve(new Request("https://app.test"))).toBeNull();
  expect(
    await manager.resolve(
      new Request("https://app.test", {
        headers: { cookie: "sid=not-a-uuid" },
      }),
    ),
  ).toBeNull();
  expect(
    await manager.resolve(
      new Request("https://app.test", {
        headers: { cookie: "broken=%E0%A4%A" },
      }),
    ),
  ).toBeNull();
});

test("the session cookie contains only the opaque session id", async () => {
  const database = {
    async anonTransaction(operation: (sql: unknown) => Promise<unknown>) {
      const sql = () => Promise.resolve([]);
      return operation(sql);
    },
  } as unknown as Database;
  const manager = createSessionManager({
    database,
    cookieName: "sid",
    createId: () => sessionA,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  const created = await manager.create({ id: userA });
  expect(created.cookie).toContain(`sid=${sessionA}`);
  expect(created.cookie).not.toContain(userA);
  expect(created.cookie).toContain("HttpOnly");
  expect(created.cookie).toContain("Secure");
  expect(created.cookie).toContain("SameSite=lax");
});
