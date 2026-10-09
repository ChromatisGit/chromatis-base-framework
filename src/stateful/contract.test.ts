import { describe, expect, test } from "bun:test";
import { connectionParams } from "./contract.js";

describe("connectionParams", () => {
  test("trusted parameters override the client's query", () => {
    const request = new Request("http://x/connect?name=ann&token=forged");
    expect(connectionParams(request, { token: "real" })).toEqual({
      name: "ann",
      token: "real",
    });
  });

  test("without trusted parameters the query is passed on", () => {
    expect(connectionParams(new Request("http://x/c?a=1"))).toEqual({ a: "1" });
  });
});
