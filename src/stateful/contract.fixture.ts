import { ValidationError } from "../errors.js";
import type { RuntimeDefinition } from "./contract.js";

/** Records what the fixture observed, for assertions across hosts. */
export const observed = { closes: [] as (string | undefined)[] };

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Application-style fixture: a chat room. Chromatis never sees its meaning. */
export const roomDefinition: RuntimeDefinition = {
  kind: "room",
  create(context, init) {
    const name = (init as { name?: string } | null)?.name ?? "unnamed";
    const log: string[] = [];
    return {
      async onCommand(command) {
        const { type, value } = command as { type: string; value?: string };
        switch (type) {
          case "info":
            return { name, log, connections: context.connections().length };
          case "append":
            log.push(`${value}:start`);
            await delay(20);
            log.push(`${value}:end`);
            return null;
          case "fail":
            throw new ValidationError("rejected by application");
          case "close":
            context.close("by-command");
            return "closing";
          default:
            return null;
        }
      },
      onConnect(connection) {
        if (connection.params.reject) {
          throw new Error("no entry");
        }
        context.broadcast(`joined:${connection.params.name ?? "?"}`);
      },
      onMessage(connection, data) {
        if (data === "boom") {
          throw new Error("handler failure");
        }
        context.broadcast(`${connection.params.name ?? "?"}:${data}`);
      },
      onDisconnect(connection) {
        log.push(`left:${connection.params.name ?? "?"}`);
      },
      onClose(reason) {
        observed.closes.push(reason);
      },
    };
  },
};
