import { errorResponse } from "./errors.js";
import type { Logger } from "./log.js";

export type RequestHandler = (request: Request) => Promise<Response>;

export function withErrorBoundary(
  handler: RequestHandler,
  logger: Logger,
): RequestHandler {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      logger.error("Request failed", {
        method: request.method,
        url: request.url,
        error: error instanceof Error ? error.message : String(error),
      });
      return errorResponse(error);
    }
  };
}
