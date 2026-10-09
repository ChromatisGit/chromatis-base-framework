export type ValidationDetails = Readonly<Record<string, readonly string[]>>;

export class AppError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  public constructor(message = "Resource not found", options?: ErrorOptions) {
    super(message, "not_found", options);
  }
}

export class ValidationError extends AppError {
  public constructor(
    message: string,
    public readonly details: ValidationDetails = {},
    options?: ErrorOptions,
  ) {
    super(message, "validation_failed", options);
  }
}

export class UnauthenticatedError extends AppError {
  public constructor(
    message = "Authentication required",
    options?: ErrorOptions,
  ) {
    super(message, "unauthenticated", options);
  }
}

export class PermissionDeniedError extends AppError {
  public constructor(message = "Permission denied", options?: ErrorOptions) {
    super(message, "permission_denied", options);
  }
}

export class ConflictError extends AppError {
  public constructor(
    message = "Resource already exists",
    options?: ErrorOptions,
  ) {
    super(message, "conflict", options);
  }
}

export function errorResponse(error: unknown): Response {
  if (!(error instanceof AppError)) {
    return Response.json(
      { error: { code: "internal_error", message: "Internal server error" } },
      { status: 500 },
    );
  }

  const status =
    error instanceof UnauthenticatedError
      ? 401
      : error instanceof PermissionDeniedError
        ? 403
        : error instanceof NotFoundError
          ? 404
          : error instanceof ConflictError
            ? 409
            : 400;
  const details = error instanceof ValidationError ? error.details : undefined;

  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(details && { details }),
      },
    },
    { status },
  );
}
