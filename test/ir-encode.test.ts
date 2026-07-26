// biome-ignore-all lint/suspicious/noThenProperty: IR branch nodes intentionally use `then`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPR_KINDS, OPCODES, STMT_KINDS, UNOP_LANES } from "../src/ir/encode-constants";
import { encodeWasm } from "../src/ir/encode-wasm";
import { binOpcode, loadOpcode, storeOpcode } from "../src/ir/expr-info";
import type { Expr, Func, IrType, Stmt, UnOp } from "../src/ir/ir";
import { validateModule } from "../src/ir/validate";
import {
  binopCases,
  constant,
  conversionCases,
  encoded,
  expressionModule,
  memoryAccessCases,
  mergeImports,
  moduleWith,
  runEncoded,
  unopCases,
} from "./ir-fixtures";

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

function functionBodies(bytes: Uint8Array): Uint8Array[] {
  const payload = sections(bytes).find(({ id }) => id === 10)!.payload;
  const [count, firstBody] = readU32(payload, 0);
  const bodies: Uint8Array[] = [];
  let offset = firstBody;
  for (let index = 0; index < count; index += 1) {
    const [size, bodyStart] = readU32(payload, offset);
    bodies.push(payload.slice(bodyStart, bodyStart + size));
    offset = bodyStart + size;
  }
  return bodies;
}

test("executes an encoded constant-return function", () => {
  assert.equal(runEncoded(expressionModule(constant("i32", 42), "i32"), "run"), 42);
});

test("executes scalar expression and variable statement kinds", () => {
  assert.equal(
    runEncoded(
      expressionModule(
        {
          k: "binop",
          op: "add",
          type: "i32",
          signed: true,
          l: constant("i32", 19),
          r: constant("i32", 23),
        },
        "i32",
      ),
      "run",
    ),
    42,
  );
  assert.equal(
    runEncoded(
      expressionModule({ k: "unop", op: "neg", type: "f64", e: constant("f64", 3.5) }, "f64"),
      "run",
    ),
    -3.5,
  );
  assert.equal(
    runEncoded(
      expressionModule(
        { k: "convert", op: "i32.wrap_i64", e: constant("i64", 4_294_967_303n) },
        "i32",
      ),
      "run",
    ),
    7,
  );
  assert.equal(
    runEncoded(
      expressionModule(
        {
          k: "if_val",
          cond: constant("i32", 1),
          then: constant("i32", 5),
          else: constant("i32", 9),
          type: "i32",
        },
        "i32",
      ),
      "run",
    ),
    5,
  );

  const variables = moduleWith({
    types: [{ params: [], results: ["i32"] }],
    globals: [
      {
        type: "i32",
        mutable: true,
        init: { k: "const", type: "i32", value: 0 },
      },
    ],
    funcs: [
      {
        sig: 0,
        locals: ["i32"],
        body: [
          { k: "global.set", id: 0, e: constant("i32", 11) },
          {
            k: "return",
            values: [
              {
                k: "seq",
                stmts: [
                  { k: "local.set", id: 0, e: { k: "global.get", id: 0 } },
                  { k: "drop", e: constant("i32", 99) },
                ],
                value: { k: "local.get", id: 0 },
              },
            ],
          },
        ],
        export: "run",
      },
    ],
  });
  assert.equal(runEncoded(variables, "run"), 11);
});

test("executes calls and memory expression and statement kinds", () => {
  const direct = moduleWith({
    types: [{ params: [], results: ["i32"] }],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [constant("i32", 17)] }],
      },
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [{ k: "call", fn: 0, args: [] }] }],
        export: "run",
      },
    ],
  });
  assert.equal(runEncoded(direct, "run"), 17);

  const indirect = structuredClone(direct);
  indirect.table = { entries: [0] };
  indirect.funcs[1]!.body = [
    {
      k: "return",
      values: [{ k: "call_indirect", sig: 0, index: constant("i32", 0), args: [] }],
    },
  ];
  assert.equal(runEncoded(indirect, "run"), 17);

  const memory = moduleWith({
    types: [{ params: [], results: ["i32"] }],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "store",
            type: "i32",
            addr: constant("i32", 0),
            value: constant("i32", 0x1234_5678),
            offset: 0,
          },
          {
            k: "memory.copy",
            dest: constant("i32", 4),
            src: constant("i32", 0),
            len: constant("i32", 4),
          },
          {
            k: "return",
            values: [
              {
                k: "load",
                type: "i32",
                addr: constant("i32", 4),
                offset: 0,
              },
            ],
          },
        ],
        export: "run",
      },
    ],
  });
  assert.equal(runEncoded(memory, "run"), 0x1234_5678);
  assert.equal(runEncoded(expressionModule({ k: "memory.size" }, "i32"), "run"), 1);
  assert.equal(
    runEncoded(expressionModule({ k: "memory.grow", pages: constant("i32", 1) }, "i32"), "run"),
    1,
  );

  const statementCalls = moduleWith({
    types: [
      { params: [], results: [] },
      { params: [], results: ["i32"] },
    ],
    globals: [
      {
        type: "i32",
        mutable: true,
        init: { k: "const", type: "i32", value: 0 },
      },
    ],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [{ k: "global.set", id: 0, e: constant("i32", 29) }],
      },
      {
        sig: 1,
        locals: [],
        body: [
          { k: "call", fn: 0, args: [] },
          { k: "return", values: [{ k: "global.get", id: 0 }] },
        ],
        export: "direct",
      },
      {
        sig: 1,
        locals: [],
        body: [
          { k: "call_indirect", sig: 0, index: constant("i32", 0), args: [] },
          { k: "return", values: [{ k: "global.get", id: 0 }] },
        ],
        export: "indirect",
      },
    ],
    table: { entries: [0] },
  });
  assert.equal(runEncoded(statementCalls, "direct"), 29);
  assert.equal(runEncoded(statementCalls, "indirect"), 29);
});

test("counts synthetic if frames in branch depths and encodes control statements", () => {
  const module = moduleWith({
    types: [{ params: ["i32"], results: ["i32"] }],
    funcs: [
      {
        sig: 0,
        locals: ["i32"],
        body: [
          {
            k: "block",
            label: 10,
            body: [
              {
                k: "if",
                cond: { k: "local.get", id: 0 },
                then: [{ k: "br", label: 10 }],
                else: [],
              },
              { k: "local.set", id: 1, e: constant("i32", 5) },
            ],
          },
          {
            k: "block",
            label: 20,
            body: [
              { k: "br_if", label: 20, cond: { k: "local.get", id: 0 } },
              { k: "local.set", id: 1, e: constant("i32", 7) },
            ],
          },
          { k: "return", values: [{ k: "local.get", id: 1 }] },
        ],
        export: "run",
      },
    ],
  });
  assert.equal(runEncoded(module, "run", [1]), 0);
  assert.equal(runEncoded(module, "run", [0]), 7);

  const trapped = moduleWith({
    funcs: [{ sig: 0, locals: [], body: [{ k: "unreachable" }], export: "run" }],
  });
  assert.throws(() => runEncoded(trapped, "run"), WebAssembly.RuntimeError);
});

test("executes both multi-call callee variants with targets and drops", () => {
  const module = moduleWith({
    types: [
      { params: [], results: ["i32", "i64"] },
      { params: [], results: ["i64"] },
      { params: [], results: ["i32"] },
    ],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [constant("i32", 3), constant("i64", 4n)] }],
      },
      {
        sig: 1,
        locals: ["i32", "i64"],
        body: [
          { k: "multi_call", callee: { kind: "func", fn: 0 }, args: [], targets: [0, 1] },
          { k: "return", values: [{ k: "local.get", id: 1 }] },
        ],
        export: "directTargets",
      },
      {
        sig: 2,
        locals: [],
        body: [
          { k: "multi_call", callee: { kind: "func", fn: 0 }, args: [], targets: null },
          { k: "return", values: [constant("i32", 7)] },
        ],
        export: "directDrops",
      },
      {
        sig: 1,
        locals: ["i32", "i64"],
        body: [
          {
            k: "multi_call",
            callee: { kind: "indirect", sig: 0, index: constant("i32", 0) },
            args: [],
            targets: [0, 1],
          },
          { k: "return", values: [{ k: "local.get", id: 1 }] },
        ],
        export: "indirectTargets",
      },
      {
        sig: 2,
        locals: [],
        body: [
          {
            k: "multi_call",
            callee: { kind: "indirect", sig: 0, index: constant("i32", 0) },
            args: [],
            targets: null,
          },
          { k: "return", values: [constant("i32", 9)] },
        ],
        export: "indirectDrops",
      },
    ],
    table: { entries: [0] },
  });

  assert.equal(runEncoded(module, "directTargets"), 4n);
  assert.equal(runEncoded(module, "directDrops"), 7);
  assert.equal(runEncoded(module, "indirectTargets"), 4n);
  assert.equal(runEncoded(module, "indirectDrops"), 9);
});

test("executes every generated operation and memory-access case", () => {
  const cases = [...binopCases(), ...unopCases(), ...conversionCases(), ...memoryAccessCases()];
  for (const entry of cases) {
    assert.deepEqual(runEncoded(entry.module, entry.entry, entry.args), entry.expected, entry.name);
  }
  assert.equal(Object.keys(OPCODES).length, 152);
});

test("keeps encoder case tables and mnemonic selectors mechanically complete", () => {
  const expressionCases: Record<Expr["k"], true> = {
    const: true,
    "local.get": true,
    "global.get": true,
    binop: true,
    unop: true,
    convert: true,
    load: true,
    call: true,
    call_indirect: true,
    if_val: true,
    seq: true,
    "memory.size": true,
    "memory.grow": true,
  };
  const statementCases: Record<Stmt["k"], true> = {
    "local.set": true,
    "global.set": true,
    store: true,
    call: true,
    drop: true,
    multi_call: true,
    call_indirect: true,
    if: true,
    block: true,
    loop: true,
    br: true,
    br_if: true,
    return: true,
    unreachable: true,
    "memory.copy": true,
  };
  assert.deepEqual(Object.keys(expressionCases).sort(), Object.keys(EXPR_KINDS).sort());
  assert.deepEqual(Object.keys(statementCases).sort(), Object.keys(STMT_KINDS).sort());

  for (const entry of binopCases()) {
    const statement = entry.module.funcs[0]!.body[0] as Extract<Stmt, { k: "return" }>;
    const expression = statement.values[0] as Extract<Expr, { k: "binop" }>;
    assert.equal(
      binOpcode(expression.op, expression.type, expression.signed) in OPCODES,
      true,
      entry.name,
    );
  }
  for (const [op, lanes] of Object.entries(UNOP_LANES) as Array<[UnOp, readonly IrType[]]>) {
    for (const lane of lanes) assert.equal(`${lane}.${op}` in OPCODES, true);
  }
  const generatedUnopLanes = Object.fromEntries(
    Object.keys(UNOP_LANES).map((op) => [op, [] as IrType[]]),
  ) as Record<UnOp, IrType[]>;
  for (const entry of unopCases()) {
    const statement = entry.module.funcs[0]!.body[0] as Extract<Stmt, { k: "return" }>;
    const expression = statement.values[0] as Extract<Expr, { k: "unop" }>;
    generatedUnopLanes[expression.op].push(expression.type);
  }
  assert.deepEqual(generatedUnopLanes, UNOP_LANES);
  for (const type of ["i32", "i64", "f32", "f64"] as const) {
    assert.equal(loadOpcode(type, undefined, undefined) in OPCODES, true);
    assert.equal(storeOpcode(type, undefined) in OPCODES, true);
  }
  for (const type of ["i32", "i64"] as const) {
    for (const width of [8, 16] as const) {
      for (const signed of [true, false]) {
        assert.equal(loadOpcode(type, width, signed) in OPCODES, true);
      }
      assert.equal(storeOpcode(type, width) in OPCODES, true);
    }
  }
});

test("throws the two pinned mystery-kind encoder guards", () => {
  const expression = expressionModule({ k: "mystery" } as never, "i32");
  const statement = moduleWith({
    funcs: [{ sig: 0, locals: [], body: [{ k: "mystery" } as never] }],
  });
  assert.throws(
    () => encodeWasm(expression),
    (error) =>
      error instanceof Error && error.message === "encode: unknown IR expression kind: mystery",
  );
  assert.throws(
    () => encodeWasm(statement),
    (error) =>
      error instanceof Error && error.message === "encode: unknown IR statement kind: mystery",
  );
});

test("executes the complete structured depth ladder", () => {
  const nestedIfs = moduleWith({
    types: [{ params: ["i32"], results: ["i32"] }],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "block",
            label: 1,
            body: [
              {
                k: "if",
                cond: { k: "local.get", id: 0 },
                then: [
                  {
                    k: "if",
                    cond: { k: "local.get", id: 0 },
                    then: [{ k: "br", label: 1 }],
                  },
                ],
              },
              { k: "local.set", id: 0, e: constant("i32", 99) },
            ],
          },
          { k: "return", values: [{ k: "local.get", id: 0 }] },
        ],
        export: "run",
      },
    ],
  });
  assert.equal(runEncoded(nestedIfs, "run", [1]), 1);

  const loopAndBlock = moduleWith({
    types: [{ params: ["i32"], results: ["i32"] }],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "loop",
            label: 2,
            body: [
              {
                k: "local.set",
                id: 0,
                e: {
                  k: "binop",
                  op: "sub",
                  type: "i32",
                  signed: true,
                  l: { k: "local.get", id: 0 },
                  r: constant("i32", 1),
                },
              },
              { k: "br_if", label: 2, cond: { k: "local.get", id: 0 } },
            ],
          },
          {
            k: "block",
            label: 3,
            body: [
              { k: "br", label: 3 },
              { k: "local.set", id: 0, e: constant("i32", 99) },
            ],
          },
          { k: "return", values: [{ k: "local.get", id: 0 }] },
        ],
        export: "run",
      },
    ],
  });
  assert.equal(runEncoded(loopAndBlock, "run", [3]), 0);

  const confined = expressionModule(
    {
      k: "if_val",
      cond: constant("i32", 1),
      then: {
        k: "seq",
        stmts: [
          {
            k: "block",
            label: 4,
            body: [
              {
                k: "if",
                cond: constant("i32", 1),
                then: [{ k: "br", label: 4 }],
              },
              { k: "unreachable" },
            ],
          },
        ],
        value: constant("i32", 7),
      },
      else: constant("i32", 0),
      type: "i32",
    },
    "i32",
  );
  assert.equal(runEncoded(confined, "run"), 7);

  const nestedReturn = moduleWith({
    types: [{ params: [], results: ["i32"] }],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "block",
            label: 5,
            body: [
              {
                k: "if",
                cond: constant("i32", 1),
                then: [{ k: "return", values: [constant("i32", 13)] }],
              },
            ],
          },
          { k: "return", values: [constant("i32", 0)] },
        ],
        export: "run",
      },
    ],
  });
  assert.equal(runEncoded(nestedReturn, "run"), 13);

  const nestedTrap = moduleWith({
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "block",
            label: 6,
            body: [
              {
                k: "if",
                cond: constant("i32", 1),
                then: [{ k: "unreachable" }],
              },
            ],
          },
        ],
        export: "run",
      },
    ],
  });
  assert.throws(() => runEncoded(nestedTrap, "run"), WebAssembly.RuntimeError);
});

test("merges automatic and caller imports per namespace with fresh memory", () => {
  const module = moduleWith({
    memory: { initialPages: 2, mode: "imported" },
  });
  const hostFunction = () => 7;
  const first = mergeImports(module, {
    runtime: { clock: hostFunction },
    host: { value: 3 },
  });
  const second = mergeImports(module, {
    runtime: { clock: hostFunction },
    host: { value: 3 },
  });

  assert.ok(first.runtime!.memory instanceof WebAssembly.Memory);
  assert.ok(second.runtime!.memory instanceof WebAssembly.Memory);
  assert.notEqual(first.runtime!.memory, second.runtime!.memory);
  assert.equal(first.runtime!.clock, hostFunction);
  assert.equal(first.host!.value, 3);

  const callerMemory = new WebAssembly.Memory({ initial: 2 });
  const overridden = mergeImports(module, {
    runtime: { memory: callerMemory, clock: hostFunction },
  });
  assert.equal(overridden.runtime!.memory, callerMemory);
  assert.equal(overridden.runtime!.clock, hostFunction);
});

test("preserves combined function and global index spaces and raw reflection order", () => {
  const module = moduleWith({
    types: [
      { params: [], results: ["i32"] },
      { params: [], results: [] },
    ],
    funcImports: [{ module: "host", name: "imported", sig: 0 }],
    globalImports: [{ module: "host", name: "importedGlobal", type: "i32" }],
    globals: [
      {
        type: "i32",
        mutable: true,
        init: { k: "const", type: "i32", value: 5 },
        export: "definedGlobal",
      },
    ],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [constant("i32", 20)] }],
        export: "defined",
      },
      {
        sig: 1,
        locals: [],
        body: [{ k: "global.set", id: 1, e: constant("i32", 77) }],
      },
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [{ k: "global.get", id: 1 }] }],
        export: "started",
      },
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [{ k: "call", fn: 0, args: [] }] }],
        export: "callImported",
      },
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "return",
            values: [{ k: "call_indirect", sig: 0, args: [], index: constant("i32", 0) }],
          },
        ],
        export: "tableImported",
      },
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "return",
            values: [{ k: "call_indirect", sig: 0, args: [], index: constant("i32", 1) }],
          },
        ],
        export: "tableDefined",
      },
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [{ k: "global.get", id: 0 }] }],
        export: "readImported",
      },
    ],
    table: { entries: [0, 1] },
    start: 2,
    funcNames: [
      [0, "imported"],
      [1, "defined"],
      [2, "start"],
      [3, "started"],
      [4, "callImported"],
      [5, "tableImported"],
      [6, "tableDefined"],
      [7, "readImported"],
    ],
    globalNames: [
      [0, "importedGlobal"],
      [1, "definedGlobal"],
    ],
  });
  const compiled = compileWasm(encoded(module));
  assert.deepEqual(WebAssembly.Module.imports(compiled), [
    { module: "host", name: "imported", kind: "function" },
    { module: "host", name: "importedGlobal", kind: "global" },
  ]);
  assert.deepEqual(WebAssembly.Module.exports(compiled), [
    { name: "memory", kind: "memory" },
    { name: "definedGlobal", kind: "global" },
    { name: "defined", kind: "function" },
    { name: "started", kind: "function" },
    { name: "callImported", kind: "function" },
    { name: "tableImported", kind: "function" },
    { name: "tableDefined", kind: "function" },
    { name: "readImported", kind: "function" },
  ]);

  const instance = new WebAssembly.Instance(compiled, {
    host: {
      imported: () => 11,
      importedGlobal: new WebAssembly.Global({ value: "i32" }, 33),
    },
  });
  assert.deepEqual(Object.keys(instance.exports), [
    "memory",
    "definedGlobal",
    "defined",
    "started",
    "callImported",
    "tableImported",
    "tableDefined",
    "readImported",
  ]);
  const call = (name: string) => (instance.exports[name] as CallableFunction)();
  assert.equal(call("defined"), 20);
  assert.equal(call("started"), 77);
  assert.equal(call("callImported"), 11);
  assert.equal(call("tableImported"), 11);
  assert.equal(call("tableDefined"), 20);
  assert.equal(call("readImported"), 33);
  assert.equal((instance.exports.definedGlobal as WebAssembly.Global).value, 77);
});

test("encodes locals as exact adjacent RLE runs and multi-byte indices", () => {
  const module = moduleWith({
    types: [
      { params: [], results: [] },
      { params: [], results: ["i32"] },
    ],
    funcs: [
      { sig: 0, locals: [], body: [] },
      { sig: 0, locals: ["i32"], body: [] },
      { sig: 0, locals: ["i32", "i32", "f64"], body: [] },
      { sig: 0, locals: ["i32", "i64", "i32"], body: [] },
      {
        sig: 1,
        locals: Array<IrType>(129).fill("i32"),
        body: [{ k: "return", values: [{ k: "local.get", id: 128 }] }],
        export: "wide",
      },
    ],
  });
  assert.deepEqual(functionBodies(encoded(module)), [
    Uint8Array.of(0x00, 0x0b),
    Uint8Array.of(0x01, 0x01, 0x7f, 0x0b),
    Uint8Array.of(0x02, 0x02, 0x7f, 0x01, 0x7c, 0x0b),
    Uint8Array.of(0x03, 0x01, 0x7f, 0x01, 0x7e, 0x01, 0x7f, 0x0b),
    Uint8Array.of(0x01, 0x81, 0x01, 0x7f, 0x20, 0x80, 0x01, 0x0f, 0x0b),
  ]);
  assert.equal(runEncoded(module, "wide"), 0);
});

test("emits exact natural memarg alignment exponents for every load and store", () => {
  for (const entry of memoryAccessCases()) {
    const statement = entry.module.funcs[0]!.body[0]!;
    const access =
      statement.k === "store"
        ? statement
        : ((statement as Extract<Stmt, { k: "return" }>).values[0] as Extract<Expr, { k: "load" }>);
    const mnemonic =
      access.k === "store"
        ? storeOpcode(access.type, access.width)
        : loadOpcode(access.type, access.width, access.signed);
    const expectedAlignment =
      access.width === 8
        ? 0
        : access.width === 16
          ? 1
          : access.type === "i64" || access.type === "f64"
            ? 3
            : 2;
    const body = functionBodies(encoded(entry.module))[0]!;
    const opcodeOffset = body.lastIndexOf(OPCODES[mnemonic]!);
    assert.notEqual(opcodeOffset, -1, entry.name);
    assert.equal(body[opcodeOffset + 1], expectedAlignment, entry.name);
    assert.equal(body[opcodeOffset + 2], 0, entry.name);
  }
});

test("distinguishes an absent statement else from an explicitly empty else", () => {
  const absent = moduleWith({
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [{ k: "if", cond: constant("i32", 0), then: [] }],
      },
    ],
  });
  const empty = moduleWith({
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [{ k: "if", cond: constant("i32", 0), then: [], else: [] }],
      },
    ],
  });
  assert.deepEqual(
    functionBodies(encoded(absent))[0],
    Uint8Array.of(0x00, 0x41, 0x00, 0x04, 0x40, 0x0b, 0x0b),
  );
  assert.deepEqual(
    functionBodies(encoded(empty))[0],
    Uint8Array.of(0x00, 0x41, 0x00, 0x04, 0x40, 0x05, 0x0b, 0x0b),
  );
});

test("executes boundary constants, all-lane blocktypes, and arithmetic traps", () => {
  const constants: Array<{ type: IrType; value: number | bigint }> = [
    { type: "i32", value: -0x8000_0000 },
    { type: "i32", value: 0x7fff_ffff },
    { type: "i64", value: -0x8000_0000_0000_0000n },
    { type: "i64", value: 0x7fff_ffff_ffff_ffffn },
    { type: "f32", value: -0 },
    { type: "f32", value: Number.POSITIVE_INFINITY },
    { type: "f32", value: Number.NEGATIVE_INFINITY },
    { type: "f32", value: Number.NaN },
    { type: "f64", value: -0 },
    { type: "f64", value: Number.POSITIVE_INFINITY },
    { type: "f64", value: Number.NEGATIVE_INFINITY },
    { type: "f64", value: Number.NaN },
  ];
  for (const { type, value } of constants) {
    const actual = runEncoded(expressionModule(constant(type, value), type), "run");
    if (typeof value === "number" && Number.isNaN(value)) {
      assert.equal(Number.isNaN(actual), true, `${type} NaN`);
    } else {
      assert.equal(Object.is(actual, value), true, `${type} ${String(value)}`);
    }
  }

  const blockValues: Record<IrType, number | bigint> = {
    i32: 17,
    i64: 18n,
    f32: 19.5,
    f64: -20.25,
  };
  for (const type of ["i32", "i64", "f32", "f64"] as const) {
    const value = blockValues[type];
    assert.equal(
      runEncoded(
        expressionModule(
          {
            k: "if_val",
            cond: constant("i32", 1),
            then: constant(type, value),
            else: constant(type, type === "i64" ? 0n : 0),
            type,
          },
          type,
        ),
        "run",
      ),
      value,
    );
    assert.equal(
      runEncoded(
        expressionModule({ k: "seq", stmts: [], value: constant(type, value) }, type),
        "run",
      ),
      value,
    );
  }

  const divisionByZero = expressionModule(
    {
      k: "binop",
      op: "div",
      type: "i32",
      signed: true,
      l: constant("i32", 7),
      r: constant("i32", 0),
    },
    "i32",
  );
  assert.throws(() => runEncoded(divisionByZero, "run"), WebAssembly.RuntimeError);
});

test("preserves the pinned canonical NaN payload bits for f32 and f64", () => {
  const f32 = moduleWith({
    types: [{ params: [], results: ["i32"] }],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "store",
            type: "f32",
            addr: constant("i32", 0),
            value: constant("f32", Number.NaN),
            offset: 0,
          },
          {
            k: "return",
            values: [{ k: "load", type: "i32", addr: constant("i32", 0), offset: 0 }],
          },
        ],
        export: "run",
      },
    ],
  });
  const f64 = moduleWith({
    types: [{ params: [], results: ["i64"] }],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "store",
            type: "f64",
            addr: constant("i32", 0),
            value: constant("f64", Number.NaN),
            offset: 0,
          },
          {
            k: "return",
            values: [{ k: "load", type: "i64", addr: constant("i32", 0), offset: 0 }],
          },
        ],
        export: "run",
      },
    ],
  });
  assert.equal(runEncoded(f32, "run"), 0x7fc0_0000);
  assert.equal(runEncoded(f64, "run"), 0x7ff8_0000_0000_0000n);
});

test("instantiates legal extremes without encoder-owned range failures", () => {
  let nested: Stmt = { k: "local.set", id: 128, e: constant("i32", 42) };
  for (let label = 0; label < 140; label += 1) {
    nested = { k: "block", label, body: [nested] };
  }
  const module = moduleWith({
    types: [{ params: [], results: ["i32"] }],
    funcs: [
      {
        sig: 0,
        locals: Array<IrType>(129).fill("i32"),
        body: [
          { k: "drop", e: constant("i64", -0x8000_0000_0000_0000n) },
          { k: "drop", e: constant("i64", 0x7fff_ffff_ffff_ffffn) },
          {
            k: "if",
            cond: constant("i32", 0),
            then: [
              {
                k: "store",
                type: "i64",
                addr: constant("i32", 0),
                value: constant("i64", 1n),
                offset: 0xffff_ffff,
              },
              {
                k: "drop",
                e: {
                  k: "load",
                  type: "i64",
                  addr: constant("i32", 0),
                  offset: 0xffff_ffff,
                },
              },
            ],
          },
          nested,
          { k: "return", values: [{ k: "local.get", id: 128 }] },
        ],
        export: "run",
      },
    ],
  });
  assert.equal(runEncoded(module, "run"), 42);
});

test("evaluates every postfix operand list left-to-right", () => {
  function marker(digit: number): Func {
    return {
      sig: 0,
      locals: [],
      body: [
        {
          k: "global.set",
          id: 0,
          e: {
            k: "binop",
            op: "add",
            type: "i32",
            signed: true,
            l: {
              k: "binop",
              op: "mul",
              type: "i32",
              signed: true,
              l: { k: "global.get", id: 0 },
              r: constant("i32", 10),
            },
            r: constant("i32", digit),
          },
        },
        { k: "return", values: [constant("i32", 0)] },
      ],
    };
  }

  const mark = (fn: number): Expr => ({ k: "call", fn, args: [] });
  const readOrder: Stmt = { k: "return", values: [{ k: "global.get", id: 0 }] };
  const module = moduleWith({
    types: [
      { params: [], results: ["i32"] },
      { params: ["i32", "i32"], results: ["i32"] },
      { params: ["i32", "i32"], results: ["i32", "i32"] },
      { params: [], results: ["i32", "i32"] },
    ],
    globals: [
      {
        type: "i32",
        mutable: true,
        init: { k: "const", type: "i32", value: 0 },
      },
    ],
    funcs: [
      marker(1),
      marker(2),
      marker(3),
      {
        sig: 1,
        locals: [],
        body: [{ k: "return", values: [{ k: "global.get", id: 0 }] }],
      },
      {
        sig: 2,
        locals: [],
        body: [
          {
            k: "return",
            values: [
              { k: "local.get", id: 0 },
              { k: "local.get", id: 1 },
            ],
          },
        ],
      },
      {
        sig: 3,
        locals: [],
        body: [{ k: "return", values: [mark(0), mark(1)] }],
      },
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "drop",
            e: {
              k: "binop",
              op: "add",
              type: "i32",
              signed: true,
              l: mark(0),
              r: mark(1),
            },
          },
          readOrder,
        ],
        export: "binop",
      },
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "store",
            type: "i32",
            addr: mark(0),
            value: mark(1),
            offset: 0,
          },
          readOrder,
        ],
        export: "store",
      },
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [{ k: "call", fn: 3, args: [mark(0), mark(1)] }] }],
        export: "direct",
      },
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "return",
            values: [
              {
                k: "call_indirect",
                sig: 1,
                args: [mark(0), mark(1)],
                index: mark(2),
              },
            ],
          },
        ],
        export: "indirect",
      },
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "multi_call",
            callee: {
              kind: "indirect",
              sig: 2,
              index: {
                k: "seq",
                stmts: [{ k: "drop", e: mark(2) }],
                value: constant("i32", 1),
              },
            },
            args: [mark(0), mark(1)],
            targets: null,
          },
          readOrder,
        ],
        export: "indirectMulti",
      },
      {
        sig: 0,
        locals: [],
        body: [{ k: "memory.copy", dest: mark(0), src: mark(1), len: mark(2) }, readOrder],
        export: "copy",
      },
      {
        sig: 0,
        locals: [],
        body: [
          { k: "multi_call", callee: { kind: "func", fn: 5 }, args: [], targets: null },
          readOrder,
        ],
        export: "returns",
      },
    ],
    table: { entries: [3, 4] },
  });

  assert.equal(runEncoded(module, "binop"), 12);
  assert.equal(runEncoded(module, "store"), 12);
  assert.equal(runEncoded(module, "direct"), 12);
  assert.equal(runEncoded(module, "indirect"), 123);
  assert.equal(runEncoded(module, "indirectMulti"), 123);
  assert.equal(runEncoded(module, "copy"), 123);
  assert.equal(runEncoded(module, "returns"), 12);
});

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

test("emits the exact sorted sparse name-section payload", () => {
  const module = moduleWith({
    types: [
      { params: ["i32", "i64"], results: [] },
      { params: [], results: [] },
    ],
    funcImports: [{ module: "host", name: "callback", sig: 0 }],
    globalImports: [{ module: "host", name: "seed", type: "i32" }],
    funcs: [
      { sig: 0, locals: ["f32"], body: [] },
      { sig: 1, locals: [], body: [] },
    ],
    globals: [
      {
        type: "i32",
        mutable: false,
        init: { k: "const", type: "i32", value: 0 },
      },
      {
        type: "i32",
        mutable: false,
        init: { k: "const", type: "i32", value: 1 },
      },
    ],
    funcNames: [
      [1, "definedFn"],
      [0, "importedFn"],
    ],
    globalNames: [
      [1, "definedGlobal"],
      [0, "importedGlobal"],
    ],
    localNames: [
      [2, []],
      [
        1,
        [
          [2, "local"],
          [1, ""],
          [0, "param"],
        ],
      ],
      [0, [[0, "importedParam"]]],
    ],
  });
  const compiled = compileWasm(encoded(module));
  const customSections = WebAssembly.Module.customSections(compiled, "name");

  assert.equal(customSections.length, 1);
  assert.deepEqual(
    new Uint8Array(customSections[0]!),
    Uint8Array.of(
      0x01,
      0x18,
      0x02,
      0x00,
      0x0a,
      0x69,
      0x6d,
      0x70,
      0x6f,
      0x72,
      0x74,
      0x65,
      0x64,
      0x46,
      0x6e,
      0x01,
      0x09,
      0x64,
      0x65,
      0x66,
      0x69,
      0x6e,
      0x65,
      0x64,
      0x46,
      0x6e,
      0x02,
      0x24,
      0x02,
      0x00,
      0x01,
      0x00,
      0x0d,
      0x69,
      0x6d,
      0x70,
      0x6f,
      0x72,
      0x74,
      0x65,
      0x64,
      0x50,
      0x61,
      0x72,
      0x61,
      0x6d,
      0x01,
      0x03,
      0x00,
      0x05,
      0x70,
      0x61,
      0x72,
      0x61,
      0x6d,
      0x01,
      0x00,
      0x02,
      0x05,
      0x6c,
      0x6f,
      0x63,
      0x61,
      0x6c,
      0x07,
      0x20,
      0x02,
      0x00,
      0x0e,
      0x69,
      0x6d,
      0x70,
      0x6f,
      0x72,
      0x74,
      0x65,
      0x64,
      0x47,
      0x6c,
      0x6f,
      0x62,
      0x61,
      0x6c,
      0x01,
      0x0d,
      0x64,
      0x65,
      0x66,
      0x69,
      0x6e,
      0x65,
      0x64,
      0x47,
      0x6c,
      0x6f,
      0x62,
      0x61,
      0x6c,
    ),
  );
});

test("strip removes only the final name section and preserves compile-time hygiene", () => {
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
  assert.deepEqual(first, encodeWasm(metadataVariant));
  assert.equal(stripped.length < first.length, true);
  assert.deepEqual(first.subarray(0, stripped.length), stripped);
  assert.equal(first[stripped.length], 0x00);

  const [customSize, customPayloadStart] = readU32(first, stripped.length + 1);
  assert.equal(customPayloadStart + customSize, first.length);
  const [sectionNameLength, sectionNameStart] = readU32(first, customPayloadStart);
  const sectionNameEnd = sectionNameStart + sectionNameLength;
  assert.equal(new TextDecoder().decode(first.subarray(sectionNameStart, sectionNameEnd)), "name");
  assert.equal(sectionNameEnd < first.length, true);
  assert.deepEqual(
    sections(first)
      .map(({ id }) => id)
      .at(-1),
    0,
  );
  assert.equal(WebAssembly.Module.customSections(compileWasm(first), "name").length, 1);
  assert.equal(WebAssembly.Module.customSections(compileWasm(stripped), "name").length, 0);
  assert.deepEqual(module, snapshot);
});

test("omits the whole name section when every name map is empty", () => {
  const module = moduleWith({
    funcs: [{ sig: 0, locals: [], body: [] }],
    localNames: [[0, []]],
  });
  const full = encoded(module);
  const stripped = encodeWasm(module, { strip: true });

  assert.deepEqual(full, stripped);
  assert.equal(
    sections(full).some(({ id }) => id === 0),
    false,
  );
  assert.deepEqual(WebAssembly.Module.customSections(compileWasm(full), "name"), []);
});

test("sorts outer and inner name maps independently of insertion order", () => {
  function namedModule(reverse: boolean) {
    const ordered = <T>(entries: T[]): T[] => (reverse ? entries.reverse() : entries);
    return moduleWith({
      types: [{ params: ["i32"], results: [] }],
      funcs: [
        { sig: 0, locals: ["i32"], body: [] },
        { sig: 0, locals: ["i32"], body: [] },
      ],
      globals: [
        {
          type: "i32",
          mutable: false,
          init: { k: "const", type: "i32", value: 0 },
        },
        {
          type: "i32",
          mutable: false,
          init: { k: "const", type: "i32", value: 1 },
        },
      ],
      funcNames: ordered([
        [0, "firstFn"],
        [1, "secondFn"],
      ]),
      globalNames: ordered([
        [0, "firstGlobal"],
        [1, "secondGlobal"],
      ]),
      localNames: ordered([
        [
          0,
          ordered([
            [0, "firstParam"],
            [1, "firstLocal"],
          ]),
        ],
        [
          1,
          ordered([
            [0, "secondParam"],
            [1, "secondLocal"],
          ]),
        ],
      ]),
    });
  }

  const forward = namedModule(false);
  const reverse = namedModule(true);
  assert.deepEqual(forward, reverse);
  assert.deepEqual(encoded(forward), encoded(reverse));
});
