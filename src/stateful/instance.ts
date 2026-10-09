import { AppError, NotFoundError, ValidationError } from "../errors.js";
import { createLogger, type Logger } from "../log.js";
import type {
  RealtimeConnection,
  RuntimeAddress,
  RuntimeDefinition,
  RuntimeInstanceBehavior,
  RuntimeInstanceContext,
  RuntimeJson,
} from "./contract.js";

/** Host-provided transport for one realtime connection. */
export interface ConnectionTransport {
  send(data: string): void;
  close(code: number, reason: string): void;
}

type Entry = {
  readonly connection: RealtimeConnection;
  attached: boolean;
  ended: boolean;
};

/**
 * Host-neutral Runtime Instance. Both hosts delegate to this class so the
 * lifecycle, ordering and connection semantics cannot diverge; hosts only
 * adapt transports and addressing.
 */
export class RuntimeInstance {
  private behavior: RuntimeInstanceBehavior = {};
  private readonly entries = new Map<string, Entry>();
  private tail: Promise<unknown> = Promise.resolve();
  private closing = false;
  private closeReason: string | undefined;
  private readonly log: Logger;
  private readonly context: RuntimeInstanceContext;

  private constructor(
    readonly address: RuntimeAddress,
    private readonly onFinished: () => void,
  ) {
    this.log = createLogger({
      requestId: "runtime",
      module: `runtime:${address.kind}`,
    });
    const isClosing = (): boolean => this.closing;
    this.context = {
      address,
      get closed() {
        return isClosing();
      },
      connections: () =>
        [...this.entries.values()]
          .filter((entry) => entry.attached && !entry.ended)
          .map((entry) => entry.connection),
      broadcast: (data, options) => {
        for (const connection of this.context.connections()) {
          if (connection !== options?.except) {
            connection.send(data);
          }
        }
      },
      close: (reason) => {
        this.requestClose(reason);
      },
    };
  }

  static async start(
    definition: RuntimeDefinition,
    address: RuntimeAddress,
    init: RuntimeJson,
    onFinished: () => void,
  ): Promise<RuntimeInstance> {
    const instance = new RuntimeInstance(address, onFinished);
    instance.behavior = await definition.create(instance.context, init);
    return instance;
  }

  get isClosed(): boolean {
    return this.closing;
  }

  command(command: RuntimeJson): Promise<RuntimeJson> {
    return this.enqueue(async () => {
      this.assertOpen();
      if (!this.behavior.onCommand) {
        throw new ValidationError("Instance does not accept commands");
      }
      const result = await this.behavior.onCommand(roundTrip(command));
      return roundTrip(result ?? null);
    });
  }

  /** Attaches a connection. Resolves false when it was rejected. */
  attach(
    transport: ConnectionTransport,
    params: Readonly<Record<string, string>>,
  ): { id: string; ready: Promise<boolean> } {
    const id = crypto.randomUUID();
    const entry: Entry = {
      attached: false,
      ended: false,
      connection: {
        id,
        params,
        send: (data) => {
          if (!entry.ended) {
            transport.send(data);
          }
        },
        close: (code = 1000, reason = "") => {
          this.end(entry, transport, code, reason);
        },
      },
    };
    this.entries.set(id, entry);
    const ready = this.enqueue(async () => {
      if (this.closing) {
        this.end(entry, transport, 1001, "closed");
        return false;
      }
      // Visible to the instance (e.g. broadcast) while onConnect runs.
      entry.attached = true;
      try {
        await this.behavior.onConnect?.(entry.connection);
      } catch (error) {
        this.logFailure("onConnect failed", error);
        entry.attached = false;
        this.end(entry, transport, 1008, "rejected");
        return false;
      }
      return !entry.ended;
    });
    return { id, ready };
  }

  message(id: string, data: string): Promise<void> {
    return this.enqueue(async () => {
      const entry = this.entries.get(id);
      if (!entry?.attached || entry.ended) {
        return;
      }
      try {
        await this.behavior.onMessage?.(entry.connection, data);
      } catch (error) {
        this.logFailure("onMessage failed", error);
        entry.connection.close(1011, "error");
      }
    });
  }

  /** The transport reports the connection ended from the remote side. */
  disconnect(id: string): Promise<void> {
    return this.enqueue(async () => {
      const entry = this.entries.get(id);
      if (entry) {
        await this.finishEntry(entry);
      }
    });
  }

  close(reason?: string): Promise<void> {
    this.requestClose(reason);
    return this.tail.then(() => undefined);
  }

  private requestClose(reason: string | undefined): void {
    if (this.closing) {
      return;
    }
    this.closing = true;
    this.closeReason = reason;
    void this.enqueue(async () => {
      for (const entry of [...this.entries.values()]) {
        entry.connection.close(1000, reason ?? "closed");
        await this.finishEntry(entry);
      }
      try {
        await this.behavior.onClose?.(this.closeReason);
      } catch (error) {
        this.logFailure("onClose failed", error);
      }
      this.onFinished();
    });
  }

  private end(
    entry: Entry,
    transport: ConnectionTransport,
    code: number,
    reason: string,
  ): void {
    if (entry.ended) {
      return;
    }
    entry.ended = true;
    transport.close(code, reason);
    if (entry.attached) {
      void this.enqueue(() => this.finishEntry(entry));
    } else {
      this.entries.delete(entry.connection.id);
    }
  }

  private async finishEntry(entry: Entry): Promise<void> {
    const wasAttached = entry.attached;
    entry.ended = true;
    entry.attached = false;
    if (!this.entries.delete(entry.connection.id) || !wasAttached) {
      return;
    }
    try {
      await this.behavior.onDisconnect?.(entry.connection);
    } catch (error) {
      this.logFailure("onDisconnect failed", error);
    }
  }

  private assertOpen(): void {
    if (this.closing) {
      throw new NotFoundError("Runtime instance is closed");
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private logFailure(message: string, error: unknown): void {
    this.log.error(message, {
      address: `${this.address.kind}/${this.address.id}`,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof AppError && { code: error.code }),
    });
  }
}

/** Enforces the JSON-serializable contract identically on every host. */
export function roundTrip(value: RuntimeJson): RuntimeJson {
  const text = JSON.stringify(value);
  if (text === undefined) {
    throw new ValidationError("Runtime values must be JSON-serializable");
  }
  return JSON.parse(text) as RuntimeJson;
}
