/**
 * Stateful Runtime contract.
 *
 * Chromatis provides addressable, temporary, coordinated Runtime Instances.
 * It never interprets the state or the messages: applications define both.
 *
 * Semantics every Runtime Host guarantees:
 *
 * - An instance is addressed by `(kind, id)` and exists from `create` until it
 *   is closed. State lives in memory for that lifetime only; it is not
 *   application persistence and does not survive a host restart or eviction.
 * - All entry points of one instance (commands, connects, messages,
 *   disconnects, close) run one at a time, in arrival order.
 * - Commands and their results must be JSON-serializable.
 * - Realtime messages are text frames; the application defines their meaning.
 * - Closing an instance closes every connection (code 1000), runs `onClose`
 *   once, and makes the address unknown. Closing is idempotent.
 * - The address can be created again after it was closed.
 */

export type RuntimeJson =
  | null
  | boolean
  | number
  | string
  | readonly RuntimeJson[]
  | { readonly [key: string]: RuntimeJson };

export type RuntimeAddress = Readonly<{ kind: string; id: string }>;

export interface RealtimeConnection {
  readonly id: string;
  /** Query parameters of the connect request. */
  readonly params: Readonly<Record<string, string>>;
  /** Sends a text frame. Ignored once the connection is closed. */
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RuntimeInstanceContext {
  readonly address: RuntimeAddress;
  readonly closed: boolean;
  connections(): readonly RealtimeConnection[];
  broadcast(data: string, options?: { except?: RealtimeConnection }): void;
  /** Closes this instance; takes effect after the current entry point. */
  close(reason?: string): void;
}

export interface RuntimeInstanceBehavior {
  /** Handles a command from `StatefulRuntime.command`; the result is returned. */
  onCommand?(command: RuntimeJson): RuntimeJson | Promise<RuntimeJson>;
  /** Throwing rejects the connection (closed with code 1008). */
  onConnect?(connection: RealtimeConnection): void | Promise<void>;
  /** Throwing closes that connection (code 1011); the instance continues. */
  onMessage?(
    connection: RealtimeConnection,
    data: string,
  ): void | Promise<void>;
  /** Called after an attached connection ended, from either side. */
  onDisconnect?(connection: RealtimeConnection): void | Promise<void>;
  onClose?(reason: string | undefined): void | Promise<void>;
}

export interface RuntimeDefinition {
  /** Lowercase kind name, e.g. `"room"`. */
  readonly kind: string;
  /** Builds the instance's behavior; state belongs in the returned closure. */
  create(
    context: RuntimeInstanceContext,
    init: RuntimeJson,
  ): RuntimeInstanceBehavior | Promise<RuntimeInstanceBehavior>;
}

export interface StatefulRuntime {
  readonly target: "bun" | "cloudflare";
  /** Throws `ConflictError` when the address already exists. */
  create(address: RuntimeAddress, init?: RuntimeJson): Promise<void>;
  exists(address: RuntimeAddress): Promise<boolean>;
  /** Throws `NotFoundError` when the address does not exist. */
  command(address: RuntimeAddress, command: RuntimeJson): Promise<RuntimeJson>;
  /** Closes the instance if it exists. */
  close(address: RuntimeAddress): Promise<void>;
  /**
   * Upgrades a request to a realtime connection. Return the result from the
   * fetch handler; `undefined` means the host already completed the upgrade.
   * `trusted` parameters are set by the server and override same-named query
   * parameters of the request, so they can carry credentials that never
   * appear in the client's URL. Throws `NotFoundError` when the address does
   * not exist.
   */
  connect(
    address: RuntimeAddress,
    request: Request,
    trusted?: Readonly<Record<string, string>>,
  ): Promise<Response | undefined>;
}

const KIND = /^[a-z][a-z0-9-]{0,63}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Query parameters of a connect request with the trusted ones laid over them. */
export function connectionParams(
  request: Request,
  trusted: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    ...Object.fromEntries(new URL(request.url).searchParams),
    ...trusted,
  };
}

export function assertValidAddress(address: RuntimeAddress): void {
  if (!KIND.test(address.kind) || !ID.test(address.id)) {
    throw new Error(
      `Invalid runtime address ${JSON.stringify(address)}: kind must match ${KIND}, id must match ${ID}`,
    );
  }
}

export function indexDefinitions(
  definitions: readonly RuntimeDefinition[],
): ReadonlyMap<string, RuntimeDefinition> {
  const map = new Map<string, RuntimeDefinition>();
  for (const definition of definitions) {
    if (!KIND.test(definition.kind) || map.has(definition.kind)) {
      throw new Error(`Invalid or duplicate runtime kind "${definition.kind}"`);
    }
    map.set(definition.kind, definition);
  }
  return map;
}
