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

test("share capabilities accept URL-safe session IDs", () => {
  for (const token of ["zmHJg9CwVP16q2rC6H5VRg", "Ab09_-".repeat(3) + "Ab09"]) {
    expect(validCapability("share_token", token)).toBe(true);
  }
  for (const token of [
    "a".repeat(21),
    "a".repeat(23),
    "a".repeat(21) + "/",
    "a".repeat(21) + "+",
    "a".repeat(21) + "=",
    "a".repeat(21) + " ",
    "a".repeat(21) + "\n",
    "",
  ]) {
    expect(validCapability("share_token", token)).toBe(false);
  }
});

test("share capabilities reject legacy hexadecimal tokens", () => {
  for (const token of [
    "a".repeat(48),
    "a".repeat(47),
    "A".repeat(48),
    "g".repeat(48),
  ]) {
    expect(validCapability("share_token", token)).toBe(false);
  }
});
