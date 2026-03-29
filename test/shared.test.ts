import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sizeofType } from "../src/shared/types";

describe("shared/types: sizeofType", () => {
  test("i32 is 4 bytes", () => {
    assert.equal(sizeofType("i32"), 4);
  });

  test("f32 is 4 bytes", () => {
    assert.equal(sizeofType("f32"), 4);
  });

  test("i8 is 1 byte", () => {
    assert.equal(sizeofType("i8"), 1);
  });

  test("u8 is 1 byte", () => {
    assert.equal(sizeofType("u8"), 1);
  });

  test("i16 is 2 bytes", () => {
    assert.equal(sizeofType("i16"), 2);
  });

  test("u16 is 2 bytes", () => {
    assert.equal(sizeofType("u16"), 2);
  });

  test("pointer type *i32 is 4 bytes", () => {
    assert.equal(sizeofType("*i32"), 4);
  });

  test("array type i32[] is 4 bytes", () => {
    assert.equal(sizeofType("i32[]"), 4);
  });

  test("unknown type defaults to 4 bytes", () => {
    assert.equal(sizeofType("bool"), 4);
  });
});
