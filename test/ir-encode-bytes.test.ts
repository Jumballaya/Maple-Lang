import assert from "node:assert/strict";
import { test } from "node:test";
import { ByteWriter } from "../src/ir/encode-bytes";

test("byte chunks preserve call order and snapshots remain independent", () => {
  const writer = new ByteWriter();
  writer.byte(0);
  writer.bytes(Uint8Array.from([1, 2]));
  writer.byte(255);

  const first = writer.toUint8Array();
  assert.deepEqual(first, Uint8Array.from([0, 1, 2, 255]));

  writer.byte(3);
  assert.deepEqual(first, Uint8Array.from([0, 1, 2, 255]));
  assert.deepEqual(writer.toUint8Array(), Uint8Array.from([0, 1, 2, 255, 3]));
});

test("u32 emits unsigned LEB128 through the full 32-bit range", () => {
  const rows: Array<[number, number[]]> = [
    [0, [0x00]],
    [1, [0x01]],
    [63, [0x3f]],
    [64, [0x40]],
    [127, [0x7f]],
    [128, [0x80, 0x01]],
    [16_383, [0xff, 0x7f]],
    [16_384, [0x80, 0x80, 0x01]],
    [2_097_151, [0xff, 0xff, 0x7f]],
    [2_097_152, [0x80, 0x80, 0x80, 0x01]],
    [268_435_455, [0xff, 0xff, 0xff, 0x7f]],
    [268_435_456, [0x80, 0x80, 0x80, 0x80, 0x01]],
    [2 ** 31 - 1, [0xff, 0xff, 0xff, 0xff, 0x07]],
    [2 ** 31, [0x80, 0x80, 0x80, 0x80, 0x08]],
    [2 ** 32 - 1, [0xff, 0xff, 0xff, 0xff, 0x0f]],
  ];

  for (const [value, expected] of rows) {
    const writer = new ByteWriter();
    writer.u32(value);
    assert.deepEqual(writer.toUint8Array(), Uint8Array.from(expected), `${value}`);
  }
});

test("s32 emits signed LEB128 at sign and width boundaries", () => {
  const rows: Array<[number, number[]]> = [
    [0, [0x00]],
    [1, [0x01]],
    [63, [0x3f]],
    [64, [0xc0, 0x00]],
    [127, [0xff, 0x00]],
    [128, [0x80, 0x01]],
    [-1, [0x7f]],
    [-64, [0x40]],
    [-65, [0xbf, 0x7f]],
    [-8192, [0x80, 0x40]],
    [-8193, [0xff, 0xbf, 0x7f]],
    [2 ** 31 - 1, [0xff, 0xff, 0xff, 0xff, 0x07]],
    [-(2 ** 31), [0x80, 0x80, 0x80, 0x80, 0x78]],
  ];

  for (const [value, expected] of rows) {
    const writer = new ByteWriter();
    writer.s32(value);
    assert.deepEqual(writer.toUint8Array(), Uint8Array.from(expected), `${value}`);
  }
});

test("s64 emits signed LEB128 through the full 64-bit range", () => {
  const rows: Array<[bigint, number[]]> = [
    [0n, [0x00]],
    [1n, [0x01]],
    [63n, [0x3f]],
    [64n, [0xc0, 0x00]],
    [127n, [0xff, 0x00]],
    [128n, [0x80, 0x01]],
    [-1n, [0x7f]],
    [-64n, [0x40]],
    [-65n, [0xbf, 0x7f]],
    [-8192n, [0x80, 0x40]],
    [-8193n, [0xff, 0xbf, 0x7f]],
    [(1n << 31n) - 1n, [0xff, 0xff, 0xff, 0xff, 0x07]],
    [-(1n << 31n), [0x80, 0x80, 0x80, 0x80, 0x78]],
    [(1n << 63n) - 1n, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]],
    [-(1n << 63n), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x7f]],
  ];

  for (const [value, expected] of rows) {
    const writer = new ByteWriter();
    writer.s64(value);
    assert.deepEqual(writer.toUint8Array(), Uint8Array.from(expected), `${value}`);
  }
});

test("f32 emits deterministic little-endian bytes including canonical NaN", () => {
  const rows: Array<[number, number[]]> = [
    [1.5, [0x00, 0x00, 0xc0, 0x3f]],
    [-0, [0x00, 0x00, 0x00, 0x80]],
    [Number.POSITIVE_INFINITY, [0x00, 0x00, 0x80, 0x7f]],
    [Number.NaN, [0x00, 0x00, 0xc0, 0x7f]],
  ];

  for (const [value, expected] of rows) {
    const writer = new ByteWriter();
    writer.f32(value);
    assert.deepEqual(writer.toUint8Array(), Uint8Array.from(expected));
  }
});

test("f64 emits deterministic little-endian bytes including canonical NaN", () => {
  const rows: Array<[number, number[]]> = [
    [1.5, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x3f]],
    [Number.NEGATIVE_INFINITY, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0xff]],
    [Number.NaN, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x7f]],
  ];

  for (const [value, expected] of rows) {
    const writer = new ByteWriter();
    writer.f64(value);
    assert.deepEqual(writer.toUint8Array(), Uint8Array.from(expected));
  }
});

test("name prefixes UTF-8 byte length rather than string length", () => {
  const ascii = new ByteWriter();
  ascii.name("memory");
  assert.deepEqual(
    ascii.toUint8Array(),
    Uint8Array.from([0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79]),
  );

  const unicode = new ByteWriter();
  unicode.name("π");
  assert.deepEqual(unicode.toUint8Array(), Uint8Array.from([0x02, 0xcf, 0x80]));
});

test("sized prefixes empty, small, and multi-byte payload lengths", () => {
  const empty = new ByteWriter();
  empty.sized(() => {});
  assert.deepEqual(empty.toUint8Array(), Uint8Array.from([0x00]));

  const small = new ByteWriter();
  small.sized((payload) => {
    payload.byte(1);
    payload.byte(0);
    payload.byte(1);
  });
  assert.deepEqual(small.toUint8Array(), Uint8Array.from([0x03, 0x01, 0x00, 0x01]));

  const large = new ByteWriter();
  large.sized((payload) => payload.bytes(new Uint8Array(130).fill(0xaa)));
  assert.deepEqual(
    large.toUint8Array(),
    Uint8Array.from([0x82, 0x01, ...new Array<number>(130).fill(0xaa)]),
  );
});

test("section prefixes its id and a sized payload", () => {
  const empty = new ByteWriter();
  empty.section(5, () => {});
  assert.deepEqual(empty.toUint8Array(), Uint8Array.from([0x05, 0x00]));

  const small = new ByteWriter();
  small.section(5, (payload) => {
    payload.byte(1);
    payload.byte(0);
    payload.byte(1);
  });
  assert.deepEqual(small.toUint8Array(), Uint8Array.from([0x05, 0x03, 0x01, 0x00, 0x01]));

  const large = new ByteWriter();
  large.section(5, (payload) => payload.bytes(new Uint8Array(130).fill(0xaa)));
  assert.deepEqual(
    large.toUint8Array(),
    Uint8Array.from([0x05, 0x82, 0x01, ...new Array<number>(130).fill(0xaa)]),
  );
});
