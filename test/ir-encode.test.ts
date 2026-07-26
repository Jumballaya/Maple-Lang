// biome-ignore-all lint/suspicious/noThenProperty: IR branch nodes intentionally use `then`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeWasm } from "../src/ir/encode-wasm";
import { validateModule } from "../src/ir/validate";
import { moduleWith } from "./ir-fixtures";

type Section = { id: number; payload: Uint8Array };

function readU32(bytes: Uint8Array, start: number): [number, number] {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (true) {
    const byte = bytes[offset++]!;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, offset];
    shift += 7;
  }
}

function sections(bytes: Uint8Array): Section[] {
  const output: Section[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const id = bytes[offset++]!;
    const [size, payloadStart] = readU32(bytes, offset);
    output.push({ id, payload: bytes.slice(payloadStart, payloadStart + size) });
    offset = payloadStart + size;
  }
  return output;
}

function compileWasm(bytes: Uint8Array): WebAssembly.Module {
  return new WebAssembly.Module(bytes as Uint8Array<ArrayBuffer>);
}

test("encodes the minimal owned-memory module", () => {
  const module = moduleWith({ types: [] });
  assert.deepEqual(validateModule(module), []);
  assert.deepEqual(
    encodeWasm(module),
    Uint8Array.of(
      0x00,
      0x61,
      0x73,
      0x6d,
      0x01,
      0x00,
      0x00,
      0x00,
      0x05,
      0x03,
      0x01,
      0x00,
      0x01,
      0x07,
      0x0a,
      0x01,
      0x06,
      0x6d,
      0x65,
      0x6d,
      0x6f,
      0x72,
      0x79,
      0x02,
      0x00,
    ),
  );
});

test("omits empty sections and distinguishes absent and empty tables", () => {
  const absent = moduleWith({ types: [] });
  const empty = moduleWith({ types: [], table: { entries: [] } });
  assert.deepEqual(validateModule(absent), []);
  assert.deepEqual(validateModule(empty), []);

  assert.deepEqual(
    sections(encodeWasm(absent)).map(({ id }) => id),
    [5, 7],
  );
  const emptySections = sections(encodeWasm(empty));
  assert.deepEqual(
    emptySections.map(({ id }) => id),
    [4, 5, 7],
  );
  assert.deepEqual(emptySections[0]!.payload, Uint8Array.of(0x01, 0x70, 0x01, 0x00, 0x00));
  assert.equal(
    emptySections.some(({ id }) => id === 9),
    false,
  );
});

test("encodes imported memory with the pinned host surface", () => {
  const module = moduleWith({
    types: [],
    memory: { initialPages: 2, mode: "imported" },
  });
  assert.deepEqual(validateModule(module), []);
  const bytes = encodeWasm(module);
  const compiled = compileWasm(bytes);

  assert.deepEqual(WebAssembly.Module.imports(compiled), [
    { module: "runtime", name: "memory", kind: "memory" },
  ]);
  assert.deepEqual(
    sections(bytes).map(({ id }) => id),
    [2],
  );
  assert.doesNotThrow(
    () =>
      new WebAssembly.Instance(compiled, {
        runtime: { memory: new WebAssembly.Memory({ initial: 2 }) },
      }),
  );
});

test("encodes the type-section matrix across all four lanes", () => {
  const none = moduleWith({ types: [] });
  const one = moduleWith({
    types: [{ params: ["i32", "i64", "f32", "f64"], results: ["f64", "f32", "i64", "i32"] }],
  });
  const multiple = moduleWith({
    types: [
      { params: [], results: [] },
      { params: ["i32", "f64"], results: ["i64", "f32"] },
    ],
  });
  for (const module of [none, one, multiple]) {
    assert.deepEqual(validateModule(module), []);
  }

  assert.equal(
    sections(encodeWasm(none)).some(({ id }) => id === 1),
    false,
  );
  assert.deepEqual(
    sections(encodeWasm(one)).find(({ id }) => id === 1)!.payload,
    Uint8Array.of(0x01, 0x60, 0x04, 0x7f, 0x7e, 0x7d, 0x7c, 0x04, 0x7c, 0x7d, 0x7e, 0x7f),
  );
  assert.deepEqual(
    sections(encodeWasm(multiple)).find(({ id }) => id === 1)!.payload,
    Uint8Array.of(0x02, 0x60, 0x00, 0x00, 0x60, 0x02, 0x7f, 0x7c, 0x02, 0x7e, 0x7d),
  );
});

test("preserves mixed import order and imports globals across all four lanes", () => {
  const module = moduleWith({
    types: [
      { params: [], results: [] },
      { params: ["i32"], results: [] },
    ],
    memory: { initialPages: 1, mode: "imported" },
    funcImports: [
      { module: "env", name: "first", sig: 0 },
      { module: "host", name: "second", sig: 1 },
    ],
    globalImports: [
      { module: "env", name: "gi32", type: "i32" },
      { module: "env", name: "gi64", type: "i64" },
      { module: "env", name: "gf32", type: "f32" },
      { module: "env", name: "gf64", type: "f64" },
    ],
  });
  assert.deepEqual(validateModule(module), []);
  const compiled = compileWasm(encodeWasm(module));

  assert.deepEqual(WebAssembly.Module.imports(compiled), [
    { module: "runtime", name: "memory", kind: "memory" },
    { module: "env", name: "first", kind: "function" },
    { module: "host", name: "second", kind: "function" },
    { module: "env", name: "gi32", kind: "global" },
    { module: "env", name: "gi64", kind: "global" },
    { module: "env", name: "gf32", kind: "global" },
    { module: "env", name: "gf64", kind: "global" },
  ]);
  assert.doesNotThrow(
    () =>
      new WebAssembly.Instance(compiled, {
        runtime: { memory: new WebAssembly.Memory({ initial: 1 }) },
        env: {
          first() {},
          gi32: new WebAssembly.Global({ value: "i32" }, 1),
          gi64: new WebAssembly.Global({ value: "i64" }, 2n),
          gf32: new WebAssembly.Global({ value: "f32" }, 3),
          gf64: new WebAssembly.Global({ value: "f64" }, 4),
        },
        host: { second(_value: number) {} },
      }),
  );

  const globalsOnly = moduleWith({
    types: [],
    globalImports: [
      { module: "m", name: "a", type: "i32" },
      { module: "m", name: "b", type: "i64" },
      { module: "m", name: "c", type: "f32" },
      { module: "m", name: "d", type: "f64" },
    ],
  });
  assert.deepEqual(validateModule(globalsOnly), []);
  assert.deepEqual(
    sections(encodeWasm(globalsOnly)).find(({ id }) => id === 2)!.payload,
    Uint8Array.of(
      0x04,
      0x01,
      0x6d,
      0x01,
      0x61,
      0x03,
      0x7f,
      0x00,
      0x01,
      0x6d,
      0x01,
      0x62,
      0x03,
      0x7e,
      0x00,
      0x01,
      0x6d,
      0x01,
      0x63,
      0x03,
      0x7d,
      0x00,
      0x01,
      0x6d,
      0x01,
      0x64,
      0x03,
      0x7c,
      0x00,
    ),
  );
});

test("pairs multiple function declarations with placeholder code bodies in array order", () => {
  const module = moduleWith({
    types: [
      { params: [], results: [] },
      { params: ["i32"], results: [] },
    ],
    funcs: [
      { sig: 1, locals: [], body: [] },
      { sig: 0, locals: [], body: [] },
    ],
  });
  assert.deepEqual(validateModule(module), []);
  const bytes = encodeWasm(module);
  const encoded = sections(bytes);

  assert.deepEqual(
    encoded.map(({ id }) => id),
    [1, 3, 5, 7, 10],
  );
  assert.deepEqual(encoded.find(({ id }) => id === 3)!.payload, Uint8Array.of(0x02, 0x01, 0x00));
  assert.deepEqual(
    encoded.find(({ id }) => id === 10)!.payload,
    Uint8Array.of(0x02, 0x02, 0x00, 0x0b, 0x02, 0x00, 0x0b),
  );
  assert.doesNotThrow(() => compileWasm(bytes));
});

test("encodes globals and exports definitions in memory-global-function order", () => {
  const module = moduleWith({
    types: [{ params: [], results: [] }],
    funcImports: [{ module: "env", name: "importedFn", sig: 0 }],
    globalImports: [{ module: "env", name: "importedGlobal", type: "i32" }],
    funcs: [{ sig: 0, locals: [], body: [], export: "definedFn" }],
    globals: [
      {
        type: "i32",
        mutable: false,
        init: { k: "const", type: "i32", value: -7 },
        export: "ci32",
      },
      {
        type: "i32",
        mutable: true,
        init: { k: "const", type: "i32", value: 8 },
        export: "mi32",
      },
      {
        type: "i64",
        mutable: false,
        init: { k: "const", type: "i64", value: -9n },
        export: "ci64",
      },
      {
        type: "i64",
        mutable: true,
        init: { k: "const", type: "i64", value: 10n },
        export: "mi64",
      },
      {
        type: "f32",
        mutable: false,
        init: { k: "const", type: "f32", value: 1.5 },
        export: "cf32",
      },
      {
        type: "f32",
        mutable: true,
        init: { k: "const", type: "f32", value: -2.5 },
        export: "mf32",
      },
      {
        type: "f64",
        mutable: false,
        init: { k: "const", type: "f64", value: 3.25 },
        export: "cf64",
      },
      {
        type: "f64",
        mutable: true,
        init: { k: "const", type: "f64", value: -4.25 },
        export: "mf64",
      },
    ],
  });
  assert.deepEqual(validateModule(module), []);
  const compiled = compileWasm(encodeWasm(module));

  assert.deepEqual(WebAssembly.Module.exports(compiled), [
    { name: "memory", kind: "memory" },
    { name: "ci32", kind: "global" },
    { name: "mi32", kind: "global" },
    { name: "ci64", kind: "global" },
    { name: "mi64", kind: "global" },
    { name: "cf32", kind: "global" },
    { name: "mf32", kind: "global" },
    { name: "cf64", kind: "global" },
    { name: "mf64", kind: "global" },
    { name: "definedFn", kind: "function" },
  ]);

  let importedCalls = 0;
  const instance = new WebAssembly.Instance(compiled, {
    env: {
      importedFn() {
        importedCalls += 1;
      },
      importedGlobal: 99,
    },
  });
  (instance.exports.definedFn as CallableFunction)();
  assert.equal(importedCalls, 0);
  assert.equal((instance.exports.ci32 as WebAssembly.Global).value, -7);
  assert.equal((instance.exports.mi32 as WebAssembly.Global).value, 8);
  assert.equal((instance.exports.ci64 as WebAssembly.Global).value, -9n);
  assert.equal((instance.exports.mi64 as WebAssembly.Global).value, 10n);
  assert.equal((instance.exports.cf32 as WebAssembly.Global).value, 1.5);
  assert.equal((instance.exports.mf32 as WebAssembly.Global).value, -2.5);
  assert.equal((instance.exports.cf64 as WebAssembly.Global).value, 3.25);
  assert.equal((instance.exports.mf64 as WebAssembly.Global).value, -4.25);
  assert.throws(() => {
    (instance.exports.ci32 as WebAssembly.Global).value = 0;
  }, TypeError);
  (instance.exports.mi32 as WebAssembly.Global).value = 42;
  assert.equal((instance.exports.mi32 as WebAssembly.Global).value, 42);
});

test("runs both defined and imported start functions during instantiation", () => {
  const defined = moduleWith({
    funcs: [{ sig: 0, locals: [], body: [] }],
    start: 0,
  });
  const imported = moduleWith({
    funcImports: [{ module: "env", name: "boot", sig: 0 }],
    start: 0,
  });
  assert.deepEqual(validateModule(defined), []);
  assert.deepEqual(validateModule(imported), []);

  const definedBytes = encodeWasm(defined);
  assert.equal(
    sections(definedBytes).some(({ id }) => id === 8),
    true,
  );
  assert.doesNotThrow(() => new WebAssembly.Instance(compileWasm(definedBytes)));

  let called = false;
  const importedBytes = encodeWasm(imported);
  assert.equal(
    sections(importedBytes).some(({ id }) => id === 8),
    true,
  );
  new WebAssembly.Instance(compileWasm(importedBytes), {
    env: {
      boot() {
        called = true;
      },
    },
  });
  assert.equal(called, true);
});

test("encodes populated table limits and an active element segment", () => {
  const module = moduleWith({
    funcImports: [
      { module: "env", name: "zero", sig: 0 },
      { module: "env", name: "one", sig: 0 },
      { module: "env", name: "two", sig: 0 },
    ],
    table: { entries: [2, 0] },
  });
  assert.deepEqual(validateModule(module), []);
  const bytes = encodeWasm(module);
  const encoded = sections(bytes);

  assert.deepEqual(
    encoded.find(({ id }) => id === 4)!.payload,
    Uint8Array.of(0x01, 0x70, 0x01, 0x02, 0x02),
  );
  assert.deepEqual(
    encoded.find(({ id }) => id === 9)!.payload,
    Uint8Array.of(0x01, 0x00, 0x41, 0x00, 0x0b, 0x02, 0x02, 0x00),
  );
  assert.doesNotThrow(() => compileWasm(bytes));
});

test("encodes active data segments with exact framing, order, and u32 boundary addresses", () => {
  const none = moduleWith({ types: [] });
  const empty = moduleWith({
    types: [],
    data: [{ addr: 0, bytes: new Uint8Array() }],
  });
  const populated = moduleWith({
    types: [],
    data: [{ addr: 4, bytes: Uint8Array.of(0x00, 0x41, 0x80, 0xff) }],
  });
  const multiple = moduleWith({
    types: [],
    data: [
      { addr: 7, bytes: Uint8Array.of(0xaa) },
      { addr: 2, bytes: Uint8Array.of(0xbb, 0xcc) },
    ],
  });
  const boundaries = moduleWith({
    types: [],
    memory: { initialPages: 65_536, mode: "owned" },
    data: [
      { addr: 0x8000_0000, bytes: new Uint8Array() },
      { addr: 0xffff_ffff, bytes: new Uint8Array() },
    ],
    dataEnd: 0xffff_ffff,
  });
  for (const module of [none, empty, populated, multiple, boundaries]) {
    assert.deepEqual(validateModule(module), []);
  }

  assert.equal(
    sections(encodeWasm(none)).some(({ id }) => id === 11),
    false,
  );
  const emptyBytes = encodeWasm(empty);
  assert.deepEqual(
    sections(emptyBytes).find(({ id }) => id === 11)!.payload,
    Uint8Array.of(0x01, 0x00, 0x41, 0x00, 0x0b, 0x00),
  );
  assert.doesNotThrow(() => new WebAssembly.Instance(compileWasm(emptyBytes)));

  const populatedBytes = encodeWasm(populated);
  assert.deepEqual(
    sections(populatedBytes).find(({ id }) => id === 11)!.payload,
    Uint8Array.of(0x01, 0x00, 0x41, 0x04, 0x0b, 0x04, 0x00, 0x41, 0x80, 0xff),
  );
  const populatedInstance = new WebAssembly.Instance(compileWasm(populatedBytes));
  assert.deepEqual(
    new Uint8Array((populatedInstance.exports.memory as WebAssembly.Memory).buffer, 4, 4),
    Uint8Array.of(0x00, 0x41, 0x80, 0xff),
  );

  assert.deepEqual(
    sections(encodeWasm(multiple)).find(({ id }) => id === 11)!.payload,
    Uint8Array.of(
      0x02,
      0x00,
      0x41,
      0x07,
      0x0b,
      0x01,
      0xaa,
      0x00,
      0x41,
      0x02,
      0x0b,
      0x02,
      0xbb,
      0xcc,
    ),
  );

  const boundaryBytes = encodeWasm(boundaries);
  assert.deepEqual(
    sections(boundaryBytes).find(({ id }) => id === 11)!.payload,
    Uint8Array.of(
      0x02,
      0x00,
      0x41,
      0x80,
      0x80,
      0x80,
      0x80,
      0x78,
      0x0b,
      0x00,
      0x00,
      0x41,
      0x7f,
      0x0b,
      0x00,
    ),
  );
  assert.doesNotThrow(() => compileWasm(boundaryBytes));
});

test("emits every applicable standard section in ascending id order", () => {
  const module = moduleWith({
    funcImports: [{ module: "env", name: "importedFn", sig: 0 }],
    globalImports: [{ module: "env", name: "importedGlobal", type: "i32" }],
    funcs: [{ sig: 0, locals: [], body: [], export: "run" }],
    globals: [
      {
        type: "i32",
        mutable: false,
        init: { k: "const", type: "i32", value: 7 },
        export: "count",
      },
    ],
    table: { entries: [0] },
    start: 1,
    data: [{ addr: 0, bytes: new Uint8Array() }],
  });
  assert.deepEqual(validateModule(module), []);
  const bytes = encodeWasm(module);

  assert.deepEqual(
    sections(bytes).map(({ id }) => id),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
  assert.doesNotThrow(
    () =>
      new WebAssembly.Instance(compileWasm(bytes), {
        env: { importedFn() {}, importedGlobal: 0 },
      }),
  );
});

test("ignores strip and compile-time metadata while encoding deterministically without mutation", () => {
  const module = moduleWith({
    memory: { initialPages: 2, mode: "owned" },
    dataEnd: 65_536,
    funcs: [{ sig: 0, locals: ["i32"], body: [] }],
    globals: [
      {
        type: "i32",
        mutable: false,
        init: { k: "const", type: "i32", value: 0 },
      },
    ],
    funcNames: [[0, "unused"]],
    globalNames: [[0, "unused"]],
    localNames: [[0, [[0, "unused"]]]],
  });
  const metadataVariant = structuredClone(module);
  metadataVariant.dataEnd = 131_072;
  metadataVariant.structLayouts.set("Point", {
    size: 8,
    align: 4,
    members: [
      { name: "x", offset: 0, mapleType: "i32", lane: "i32" },
      { name: "y", offset: 4, mapleType: "i32", lane: "i32" },
    ],
  });
  assert.deepEqual(validateModule(module), []);
  assert.deepEqual(validateModule(metadataVariant), []);
  const snapshot = structuredClone(module);

  const first = encodeWasm(module);
  const second = encodeWasm(module);
  const stripped = encodeWasm(module, { strip: true });
  assert.deepEqual(first, second);
  assert.deepEqual(first, stripped);
  assert.deepEqual(first, encodeWasm(metadataVariant));
  assert.equal(
    sections(first).some(({ id }) => id === 0),
    false,
  );
  assert.deepEqual(module, snapshot);
});
