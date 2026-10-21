import { describe, expect, test } from "bun:test";
import { requestMemo, withRequestScope } from "./request-scope.js";

describe("requestMemo", () => {
  test("computes once per request and key, across awaits", async () => {
    let calls = 0;
    const make = () => ++calls;
    const values = await withRequestScope(async () => {
      const first = requestMemo("a", make);
      await Promise.resolve();
      const again = await new Promise<number>((resolve) =>
        setTimeout(() => resolve(requestMemo("a", make)), 0),
      );
      return [first, again, requestMemo("b", make)];
    });
    expect(values).toEqual([1, 1, 2]);
  });

  test("keeps concurrent requests apart", async () => {
    let calls = 0;
    const request = () =>
      withRequestScope(async () => {
        const value = requestMemo("a", () => ++calls);
        await new Promise((resolve) => setTimeout(resolve, 1));
        return requestMemo("a", () => ++calls) === value ? value : -1;
      });
    const [one, two] = await Promise.all([request(), request()]);
    expect(new Set([one, two])).toEqual(new Set([1, 2]));
  });

  test("computes afresh outside a request scope", () => {
    let calls = 0;
    requestMemo("a", () => ++calls);
    requestMemo("a", () => ++calls);
    expect(calls).toBe(2);
  });
});
