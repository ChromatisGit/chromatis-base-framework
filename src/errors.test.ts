import { describe, expect, test } from "bun:test";
import {
  NotFoundError,
  PermissionDeniedError,
  UnauthenticatedError,
  ValidationError,
  errorResponse,
} from "./errors.js";

describe("errorResponse", () => {
  test.each([
    [new UnauthenticatedError(), 401],
    [new PermissionDeniedError(), 403],
    [new NotFoundError(), 404],
    [new ValidationError("invalid", { email: ["Invalid email"] }), 400],
    [new Error("secret details"), 500],
  ])("maps typed errors", async (error, status) => {
    const response = errorResponse(error);
    expect(response.status).toBe(status);
    const body = (await response.json()) as { error: { message: string } };
    if (status === 500) {
      expect(body.error.message).toBe("Internal server error");
    }
  });
});
