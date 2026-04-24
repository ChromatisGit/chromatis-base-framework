export type DatabaseSetupPhase = "probe" | "lock" | "migrate" | "seed" | "ready" | "failed";

type DatabaseSetupErrorOptions = {
  message: string;
  userMessage: string;
  phase: DatabaseSetupPhase;
  context: string;
  code?: string;
  cause?: unknown;
};

export class DatabaseSetupError extends Error {
  readonly name = "DatabaseSetupError";
  readonly userMessage: string;
  readonly phase: DatabaseSetupPhase;
  readonly context: string;
  readonly code?: string;

  constructor(options: DatabaseSetupErrorOptions) {
    super(options.message, { cause: options.cause });
    this.userMessage = options.userMessage;
    this.phase = options.phase;
    this.context = options.context;
    this.code = options.code;
  }
}

export function isDatabaseSetupError(error: unknown): error is DatabaseSetupError {
  return error instanceof DatabaseSetupError;
}

export function getDatabaseSetupMessage(
  error: unknown,
  fallback = "The hosted database is not ready yet. Please retry in a moment.",
): string {
  if (isDatabaseSetupError(error)) {
    return error.userMessage;
  }

  return error instanceof Error && error.message ? error.message : fallback;
}

function extractErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  return typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

function mapDatabaseSetupMessage(rawMessage: string, code?: string): string {
  const lowerMessage = rawMessage.toLowerCase();

  if (lowerMessage.includes("blocked network")) {
    return "The hosted database connection is blocked by the database network policy.";
  }

  if (
    code === "28P01"
    || code === "28000"
    || lowerMessage.includes("password authentication failed")
  ) {
    return "The hosted database connection could not authenticate. Check DATABASE_URL.";
  }

  if (
    lowerMessage.includes("does not exist")
    || lowerMessage.includes("failed to fetch")
    || lowerMessage.includes("connect")
    || lowerMessage.includes("timeout")
  ) {
    return "The hosted database could not be reached during automatic setup.";
  }

  return "The hosted database could not be prepared automatically. Check the server logs and DATABASE_URL.";
}

export function toDatabaseSetupError(
  error: unknown,
  options: { context: string; phase: DatabaseSetupPhase },
): DatabaseSetupError {
  if (isDatabaseSetupError(error)) {
    return error;
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  const code = extractErrorCode(error);

  return new DatabaseSetupError({
    message: `[db/setup] ${options.context} failed during ${options.phase}: ${rawMessage}`,
    userMessage: mapDatabaseSetupMessage(rawMessage, code),
    phase: options.phase,
    context: options.context,
    code,
    cause: error,
  });
}
