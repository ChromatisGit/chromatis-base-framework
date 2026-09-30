export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  readonly requestId: string;
  readonly module: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly userId?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export type LogSink = (entry: LogEntry) => void;

export interface Logger {
  debug(message: string, data?: Readonly<Record<string, unknown>>): void;
  info(message: string, data?: Readonly<Record<string, unknown>>): void;
  warn(message: string, data?: Readonly<Record<string, unknown>>): void;
  error(message: string, data?: Readonly<Record<string, unknown>>): void;
}

export interface LoggerContext {
  readonly requestId: string;
  readonly module: string;
  readonly userId?: string;
}

const consoleSink: LogSink = (entry) => {
  console.log(JSON.stringify(entry));
};

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function createLogger(
  context: LoggerContext,
  sink: LogSink = consoleSink,
): Logger {
  const write = (
    level: LogLevel,
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ): void => {
    sink({ ...context, level, message, ...(data && { data }) });
  };

  return {
    debug: (message, data) => write("debug", message, data),
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warn", message, data),
    error: (message, data) => write("error", message, data),
  };
}
