import { describe, expect, test } from "bun:test";
import { DEV_OPEN_VARIABLE, devOpen } from "./dev";

describe("devOpen", () => {
  test("is on only for the exact marker value", () => {
    expect(devOpen({ [DEV_OPEN_VARIABLE]: "1" })).toBe(true);
    expect(devOpen({ [DEV_OPEN_VARIABLE]: "true" })).toBe(false);
    expect(devOpen({})).toBe(false);
  });
});
