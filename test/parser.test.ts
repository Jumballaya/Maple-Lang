import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Parser } from "../src/parser/Parser";

describe("Parser", () => {
  test("can accept source text", () => {
    const src = "let x: i32 = 41 + 1;";
    assert.doesNotThrow(() => {
      const p = new Parser(src);
    });
  });
});
