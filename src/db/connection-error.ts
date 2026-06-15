import { getRuntimeEnvVar } from "../runtime/runtime.js";
import type { DbSql } from "./types.js";

function getDatabaseTarget(): string {
  try {
    const rawUrl = getRuntimeEnvVar("DATABASE_URL") ?? "";
    const url = new URL(rawUrl);
    return `${url.hostname}:${url.port || "5432"}`;
  } catch {
    return "the configured database";
  }
}

function isConnectionRefusedError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    if ((error as { code: unknown }).code === "ECONNREFUSED") return true;
  }
  if (error instanceof AggregateError) {
    return error.errors.some((nested) => isConnectionRefusedError(nested));
  }
  return error instanceof Error && error.message.includes("ECONNREFUSED");
}

function toReadableConnectionError(error: unknown): Error {
  if (!isConnectionRefusedError(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return new Error(
    `Database connection failed: could not reach Postgres at ${getDatabaseTarget()}. `
      + `Start the local database with "bun run db".`,
    { cause: error },
  );
}

export function wrapSql(sql: DbSql): DbSql {
  const wrapped = ((first: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof first === "string") return sql(first);
    return (sql(first as TemplateStringsArray, ...values) as Promise<unknown[]>).catch(
      (error: unknown) => { throw toReadableConnectionError(error); },
    );
  }) as DbSql;
  wrapped.unsafe = (identifier: string) => sql.unsafe(identifier);
  return wrapped;
}
