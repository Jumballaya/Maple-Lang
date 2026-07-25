import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { valueTypeToWasm } from "../src/compiler/types";
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

  test("bool is 1 byte", () => {
    assert.equal(sizeofType("bool"), 1);
  });

  test("unknown type defaults to 4 bytes", () => {
    assert.equal(sizeofType("Mystery"), 4);
  });

  test("i64 is 8 bytes", () => {
    assert.equal(sizeofType("i64"), 8);
  });

  test("u64 is 8 bytes", () => {
    assert.equal(sizeofType("u64"), 8);
  });

  test("f64 is 8 bytes", () => {
    assert.equal(sizeofType("f64"), 8);
  });
});

describe("compiler/types: valueTypeToWasm", () => {
  test("i64 maps to wasm i64", () => {
    assert.equal(valueTypeToWasm("i64"), "i64");
  });

  test("u64 maps to wasm i64", () => {
    assert.equal(valueTypeToWasm("u64"), "i64");
  });

  test("f64 maps to wasm f64", () => {
    assert.equal(valueTypeToWasm("f64"), "f64");
  });

  test("maps unchanged for 32-bit types", () => {
    assert.equal(valueTypeToWasm("i32"), "i32");
    assert.equal(valueTypeToWasm("f32"), "f32");
    assert.equal(valueTypeToWasm("u8"), "i32");
    assert.equal(valueTypeToWasm("bool"), "i32");
  });
});
