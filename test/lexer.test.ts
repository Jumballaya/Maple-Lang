import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../src/lexer/Lexer";

describe("Lexer", () => {
  test("can accept source text", () => {
    const src = "let x: i32 = 1 + 1;";
    assert.doesNotThrow(() => {
      const lexer = new Lexer(src);
    });
  });
});
