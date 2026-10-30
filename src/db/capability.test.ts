import { expect, test } from "bun:test";
import { validCapability } from "./capability.js";

test("classroom capabilities accept alphanumeric join codes and legacy digits", () => {
  for (const code of ["TQK6", "ACDE", "3467", "1234"]) {
    expect(validCapability("classroom_code", code)).toBe(true);
  }
  for (const code of ["tqk6", "ABC", "ABCDE", "A.C6", " AC6", "AC6\n"]) {
    expect(validCapability("classroom_code", code)).toBe(false);
  }
});

test("share capabilities still require a complete lowercase hexadecimal token", () => {
  expect(validCapability("share_token", "a".repeat(48))).toBe(true);
  for (const token of ["a".repeat(47), "A".repeat(48), "g".repeat(48)]) {
    expect(validCapability("share_token", token)).toBe(false);
  }
});
