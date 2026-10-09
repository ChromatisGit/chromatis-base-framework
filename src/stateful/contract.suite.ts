import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import type {
  RuntimeAddress,
  RuntimeJson,
  StatefulRuntime,
} from "./contract.js";
import { delay } from "./contract.fixture.js";

/** Minimal socket surface shared by WebSocket and the Worker socket. */
export interface TestSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "message" | "close",
    listener: (event: { data?: unknown; code?: number }) => void,
  ): void;
}

export interface RuntimeHarness {
  runtime: StatefulRuntime;
  open(
    address: RuntimeAddress,
    params?: Record<string, string>,
  ): Promise<TestSocket>;
  /** Reasons passed to the fixture's `onClose`, in order. */
  closes(): Promise<(string | undefined)[]>;
  dispose(): Promise<void>;
}

class Client {
  readonly messages: string[] = [];
  closeCode: number | undefined;

  constructor(private readonly socket: TestSocket) {
    socket.addEventListener("message", (event) => {
      this.messages.push(String(event.data));
    });
    socket.addEventListener("close", (event) => {
      this.closeCode = event.code ?? 1005;
    });
  }

  send(data: string): void {
    this.socket.send(data);
  }

  close(): void {
    this.socket.close(1000);
  }
}

async function until(
  condition: () => boolean,
  what: string,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await delay(5);
  }
}

async function untilAsync(
  condition: () => Promise<boolean>,
  what: string,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await delay(5);
  }
}

const room = (id: string): RuntimeAddress => ({ kind: "room", id });

interface Context {
  readonly runtime: StatefulRuntime;
  closes(): Promise<(string | undefined)[]>;
  connect(
    id: string,
    name: string,
    params?: Record<string, string>,
  ): Promise<Client>;
}

function lifecycleTests(ctx: Context): void {
  test("creates, finds and commands an instance", async () => {
    expect(await ctx.runtime.exists(room("a"))).toBe(false);
    await ctx.runtime.create(room("a"), { name: "alpha" });
    expect(await ctx.runtime.exists(room("a"))).toBe(true);
    expect(await ctx.runtime.command(room("a"), { type: "info" })).toEqual({
      name: "alpha",
      log: [],
      connections: 0,
    });
  });

  test("rejects duplicate creation, unknown kinds and unknown instances", async () => {
    await ctx.runtime.create(room("a"));
    await expect(ctx.runtime.create(room("a"))).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      ctx.runtime.create({ kind: "nope", id: "a" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      ctx.runtime.command(room("missing"), { type: "info" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      ctx.runtime.connect(
        room("missing"),
        new Request("http://x/connect", {
          headers: { upgrade: "websocket" },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("rejects invalid addresses", async () => {
    await expect(
      ctx.runtime.create({ kind: "room", id: "a/b" }),
    ).rejects.toThrow("Invalid runtime address");
    await expect(
      ctx.runtime.exists({ kind: "Room", id: "a" }),
    ).rejects.toThrow();
  });

  test("keeps instances isolated", async () => {
    await ctx.runtime.create(room("a"), { name: "A" });
    await ctx.runtime.create(room("b"), { name: "B" });
    const a = (await ctx.runtime.command(room("a"), { type: "info" })) as {
      name: string;
    };
    const b = (await ctx.runtime.command(room("b"), { type: "info" })) as {
      name: string;
    };
    expect([a.name, b.name]).toEqual(["A", "B"]);
  });

  test("propagates typed application errors", async () => {
    await ctx.runtime.create(room("a"));
    await expect(
      ctx.runtime.command(room("a"), { type: "fail" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("runs commands one at a time in arrival order", async () => {
    await ctx.runtime.create(room("a"));
    await Promise.all([
      ctx.runtime.command(room("a"), { type: "append", value: "1" }),
      ctx.runtime.command(room("a"), { type: "append", value: "2" }),
    ]);
    const info = (await ctx.runtime.command(room("a"), { type: "info" })) as {
      log: string[];
    };
    expect(info.log).toEqual(["1:start", "1:end", "2:start", "2:end"]);
  });

  test("returns only JSON values", async () => {
    await ctx.runtime.create(room("a"));
    const result: RuntimeJson = await ctx.runtime.command(room("a"), {
      type: "unknown",
    });
    expect(result).toBeNull();
  });
}

function realtimeTests(ctx: Context): void {
  test("coordinates realtime connections and passes params", async () => {
    await ctx.runtime.create(room("a"));
    const ann = await ctx.connect("a", "ann");
    await until(() => ann.messages.includes("joined:ann"), "ann join");
    const bob = await ctx.connect("a", "bob");
    await until(() => bob.messages.includes("joined:bob"), "bob join");
    expect(ann.messages).toContain("joined:bob");

    ann.send("hello");
    await until(
      () =>
        ann.messages.includes("ann:hello") &&
        bob.messages.includes("ann:hello"),
      "broadcast",
    );
    const info = (await ctx.runtime.command(room("a"), { type: "info" })) as {
      connections: number;
    };
    expect(info.connections).toBe(2);
  });

  test("reports disconnects to the instance", async () => {
    await ctx.runtime.create(room("a"));
    const ann = await ctx.connect("a", "ann");
    await until(() => ann.messages.includes("joined:ann"), "join");
    ann.close();
    await until(() => ann.closeCode !== undefined, "close");
    let info: { log: string[]; connections: number } | undefined;
    for (let i = 0; i < 100; i++) {
      info = (await ctx.runtime.command(room("a"), { type: "info" })) as {
        log: string[];
        connections: number;
      };
      if (info.log.includes("left:ann")) {
        break;
      }
      await delay(10);
    }
    expect(info?.log).toContain("left:ann");
    expect(info?.connections).toBe(0);
  });

  test("closes a connection the application rejects", async () => {
    await ctx.runtime.create(room("a"));
    const bad = await ctx.connect("a", "eve", { reject: "1" });
    await until(() => bad.closeCode !== undefined, "rejection");
    expect(bad.closeCode).toBe(1008);
    const info = (await ctx.runtime.command(room("a"), { type: "info" })) as {
      connections: number;
      log: string[];
    };
    expect(info.connections).toBe(0);
    expect(info.log).toEqual([]);
  });

  test("isolates a failing message handler to its connection", async () => {
    await ctx.runtime.create(room("a"));
    const ann = await ctx.connect("a", "ann");
    const bob = await ctx.connect("a", "bob");
    await until(() => bob.messages.includes("joined:bob"), "joins");
    ann.send("boom");
    await until(() => ann.closeCode !== undefined, "ann closed");
    expect(ann.closeCode).toBe(1011);
    bob.send("still here");
    await until(() => bob.messages.includes("bob:still here"), "bob alive");
  });
}

function closingTests(ctx: Context): void {
  test("closing releases connections and the address", async () => {
    await ctx.runtime.create(room("a"), { name: "first" });
    const ann = await ctx.connect("a", "ann");
    await until(() => ann.messages.includes("joined:ann"), "join");

    await ctx.runtime.close(room("a"));
    await until(() => ann.closeCode !== undefined, "connection closed");
    expect(ann.closeCode).toBe(1000);
    expect(await ctx.closes()).toEqual([undefined]);
    expect(await ctx.runtime.exists(room("a"))).toBe(false);
    await expect(
      ctx.runtime.command(room("a"), { type: "info" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await ctx.runtime.close(room("a"));
    expect(await ctx.closes()).toHaveLength(1);

    await ctx.runtime.create(room("a"), { name: "second" });
    const info = (await ctx.runtime.command(room("a"), { type: "info" })) as {
      name: string;
    };
    expect(info.name).toBe("second");
  });

  test("lets the instance close itself", async () => {
    await ctx.runtime.create(room("a"));
    expect(await ctx.runtime.command(room("a"), { type: "close" })).toBe(
      "closing",
    );
    await untilAsync(async () => (await ctx.closes()).length === 1, "onClose");
    expect(await ctx.closes()).toEqual(["by-command"]);
    expect(await ctx.runtime.exists(room("a"))).toBe(false);
  });
}

/** Runs the Stateful Runtime contract against any Runtime Host. */
export function runRuntimeContractTests(
  hostName: string,
  createHarness: () => Promise<RuntimeHarness>,
): void {
  describe(`Stateful Runtime contract: ${hostName}`, () => {
    let harness: RuntimeHarness;
    const ctx: Context = {
      get runtime() {
        return harness.runtime;
      },
      closes: () => harness.closes(),
      connect: async (id, name, params = {}) =>
        new Client(await harness.open(room(id), { name, ...params })),
    };

    beforeEach(async () => {
      harness = await createHarness();
    });

    afterEach(async () => {
      await harness.dispose();
    });

    lifecycleTests(ctx);
    realtimeTests(ctx);
    closingTests(ctx);
  });
}
