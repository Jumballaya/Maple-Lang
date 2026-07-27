// biome-ignore-all lint/suspicious/noThenProperty: IR branch nodes intentionally use `then`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BinOp, ConvOp, Expr, IrModule, IrType, Stmt, UnOp } from "../src/ir/ir";
import { printWat } from "../src/ir/print-wat";
import { validateModule } from "../src/ir/validate";
import { maybeTest, runExport } from "./helpers";
import { constant, expressionModule, moduleWith, statementModule } from "./ir-fixtures";

function printed(module: IrModule): string {
  assert.deepEqual(validateModule(module), []);
  return printWat(module);
}

describe("IR WAT printer: golden modules", () => {
  test("prints an arithmetic function", () => {
    const module = expressionModule(
      {
        k: "binop",
        op: "add",
        type: "i32",
        signed: true,
        l: constant("i32", 20),
        r: constant("i32", 22),
      },
      "i32",
    );
    assert.equal(
      printed(module),
      `(module
  (memory (export "memory") 1)
  (type $t0 (func (result i32)))
  (func $run_0 (export "run") (type $t0) (result i32)
    (return (i32.add (i32.const 20) (i32.const 22)))
  )
)`,
    );
  });

  test("prints positional labels for nested control flow", () => {
    const module = moduleWith({
      funcs: [
        {
          sig: 0,
          locals: [],
          body: [
            {
              k: "block",
              label: 40,
              body: [
                {
                  k: "loop",
                  label: 90,
                  body: [
                    { k: "br_if", label: 40, cond: constant("i32") },
                    { k: "br", label: 90 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      funcNames: [[0, "control"]],
    });
    assert.equal(
      printed(module),
      `(module
  (memory (export "memory") 1)
  (type $t0 (func))
  (func $control_0 (type $t0)
    (block $L0 (loop $L1 (br_if $L0 (i32.const 0)) (br $L1)))
  )
)`,
    );
  });

  test("prints load and store widths, signedness, and offsets", () => {
    const module = moduleWith({
      funcs: [
        {
          sig: 0,
          locals: [],
          body: [
            {
              k: "store",
              type: "i32",
              width: 8,
              addr: constant("i32"),
              value: constant("i32", 7),
              offset: 3,
            },
            {
              k: "drop",
              e: {
                k: "load",
                type: "i64",
                width: 16,
                signed: false,
                addr: constant("i32"),
                offset: 9,
              },
            },
          ],
        },
      ],
    });
    assert.equal(
      printed(module),
      `(module
  (memory (export "memory") 1)
  (type $t0 (func))
  (func $f0 (type $t0)
    (i32.store8 offset=3 (i32.const 0) (i32.const 7))
    (drop (i64.load16_u offset=9 (i32.const 0)))
  )
)`,
    );
  });

  test("prints table, elem, call_indirect, and start", () => {
    const module = moduleWith({
      types: [
        { params: ["i32"], results: ["i32"] },
        { params: [], results: [] },
      ],
      funcs: [
        {
          sig: 0,
          locals: [],
          body: [{ k: "return", values: [{ k: "local.get", id: 0 }] }],
        },
        {
          sig: 1,
          locals: [],
          body: [
            {
              k: "drop",
              e: {
                k: "call_indirect",
                sig: 0,
                index: constant("i32"),
                args: [constant("i32", 4)],
              },
            },
          ],
        },
      ],
      table: { entries: [0] },
      start: 1,
      funcNames: [
        [0, "identity"],
        [1, "boot"],
      ],
      localNames: [[0, [[0, "value"]]]],
    });
    const wat = printed(module);
    assert.match(wat, /\(table \$__fn_table 1 1 funcref\)/);
    assert.match(wat, /\(elem \(i32\.const 0\) func \$identity_0\)/);
    assert.match(wat, /\(call_indirect \(type \$t0\) \(i32\.const 4\) \(i32\.const 0\)\)/);
    assert.match(wat, /\(start \$boot_1\)/);
  });

  test("prints data as all-byte escapes and exports globals inline", () => {
    const module = moduleWith({
      globals: [
        {
          type: "i32",
          mutable: true,
          init: { k: "const", type: "i32", value: 7 },
          export: "count",
        },
      ],
      data: [{ addr: 65_536, bytes: new Uint8Array([0, 0x41, 0x80, 0xff]) }],
      dataEnd: 65_540,
      memory: { initialPages: 2, mode: "owned" },
      globalNames: [[0, "count"]],
    });
    assert.equal(
      printed(module),
      `(module
  (memory (export "memory") 2)
  (global $count_0 (export "count") (mut i32) (i32.const 7))
  (type $t0 (func))
  (data (offset (i32.const 65536)) "\\00\\41\\80\\ff")
)`,
    );
  });

  test("prints multi-value returns, if_val, seq, and both multi_call forms", () => {
    const module = moduleWith({
      types: [
        { params: [], results: ["i32", "i64"] },
        { params: [], results: [] },
      ],
      funcs: [
        {
          sig: 0,
          locals: [],
          body: [{ k: "return", values: [constant("i32", 1), constant("i64", 2n)] }],
        },
        {
          sig: 1,
          locals: ["i32", "i64"],
          body: [
            {
              k: "multi_call",
              callee: { kind: "func", fn: 0 },
              args: [],
              targets: [0, 1],
            },
            {
              k: "multi_call",
              callee: { kind: "indirect", sig: 0, index: constant("i32") },
              args: [],
              targets: null,
            },
            {
              k: "drop",
              e: {
                k: "seq",
                stmts: [{ k: "local.set", id: 0, e: constant("i32", 5) }],
                value: {
                  k: "if_val",
                  cond: constant("i32", 1),
                  then: { k: "local.get", id: 0 },
                  else: constant("i32", 0),
                  type: "i32",
                },
              },
            },
          ],
        },
      ],
      table: { entries: [0] },
      funcNames: [
        [0, "pair"],
        [1, "consume"],
      ],
      localNames: [
        [
          1,
          [
            [0, "left"],
            [1, "right"],
          ],
        ],
      ],
    });
    const wat = printed(module);
    assert.match(wat, /\(result i32 i64\)/);
    assert.match(
      wat,
      /\(call \$pair_0\)\n {4}\(local\.set \$right_1\)\n {4}\(local\.set \$left_0\)/,
    );
    assert.match(
      wat,
      /\(call_indirect \(type \$t0\) \(i32\.const 0\)\)\n {4}\(drop\)\n {4}\(drop\)/,
    );
    assert.match(
      wat,
      /\(block \(result i32\) \(local\.set \$left_0 \(i32\.const 5\)\) \(if \(result i32\)/,
    );
  });
});

describe("IR WAT printer: naming, escaping, memory, and table shapes", () => {
  test("same-named locals remain distinct", () => {
    const module = moduleWith({
      funcs: [
        {
          sig: 0,
          locals: ["i32", "i32"],
          body: [
            { k: "local.set", id: 0, e: constant("i32", 1) },
            { k: "local.set", id: 1, e: constant("i32", 2) },
          ],
        },
      ],
      localNames: [
        [
          0,
          [
            [0, "shadow"],
            [1, "shadow"],
          ],
        ],
      ],
    });
    const wat = printed(module);
    assert.match(wat, /\(local \$shadow_0 i32\)/);
    assert.match(wat, /\(local \$shadow_1 i32\)/);
  });

  test("imports and adversarial defined names cannot collide", () => {
    const module = moduleWith({
      funcImports: [{ module: "env", name: "f", sig: 0 }],
      globalImports: [{ module: "env", name: "g", type: "i32" }],
      funcs: [{ sig: 0, locals: [], body: [] }],
      globals: [{ type: "i32", mutable: false, init: { k: "const", type: "i32", value: 0 } }],
      funcNames: [[1, "f0"]],
      globalNames: [[1, "g0"]],
    });
    const wat = printed(module);
    assert.match(wat, /\(func \$f0\)/);
    assert.match(wat, /\(func \$f0_1 /);
    assert.match(wat, /\(global \$g0 i32\)/);
    assert.match(wat, /\(global \$g0_1 i32 /);
  });

  test("escapes hostile quoted names as UTF-8 WAT strings", () => {
    const module = moduleWith({
      funcImports: [{ module: 'm"\\\n☃', name: 'n\0"x', sig: 0 }],
      funcs: [{ sig: 0, locals: [], body: [], export: 'run"\\\n☃' }],
      funcNames: [[1, "run"]],
    });
    const wat = printed(module);
    assert.ok(wat.includes('(import "m\\"\\\\\\0a\\e2\\98\\83" "n\\00\\"x"'));
    assert.ok(wat.includes('(export "run\\"\\\\\\0a\\e2\\98\\83")'));
  });

  test("distinguishes absent, empty, and populated tables", () => {
    const absent = moduleWith({});
    const empty = moduleWith({ table: { entries: [] } });
    assert.doesNotMatch(printed(absent), /\(table /);
    const emptyWat = printed(empty);
    assert.match(emptyWat, /\(table \$__fn_table 0 0 funcref\)/);
    assert.doesNotMatch(emptyWat, /\(elem /);
  });

  test("prints both pinned memory modes", () => {
    const owned = printed(moduleWith({ memory: { initialPages: 3, mode: "owned" } }));
    const imported = printed(moduleWith({ memory: { initialPages: 3, mode: "imported" } }));
    assert.match(owned, /\(memory \(export "memory"\) 3\)/);
    assert.doesNotMatch(owned, /\(import "runtime" "memory"/);
    assert.match(imported, /\(import "runtime" "memory" \(memory 3\)\)/);
    assert.doesNotMatch(imported, /\(memory \(export "memory"\)/);
  });

  test("is deterministic and does not mutate the module", () => {
    const module = expressionModule(constant("i32", 7), "i32");
    const snapshot = structuredClone(module);
    const first = printed(module);
    assert.equal(printWat(module), first);
    assert.deepEqual(module, snapshot);
  });
});

describe("IR WAT printer: numeric fidelity", () => {
  maybeTest("prints and executes all non-finite float spellings", () => {
    const module = moduleWith({
      types: [
        { params: [], results: ["f32"] },
        { params: [], results: ["f64"] },
      ],
      funcs: [
        {
          sig: 0,
          locals: [],
          body: [{ k: "return", values: [constant("f32", Number.NaN)] }],
          export: "nan32",
        },
        {
          sig: 0,
          locals: [],
          body: [{ k: "return", values: [constant("f32", Number.POSITIVE_INFINITY)] }],
          export: "inf32",
        },
        {
          sig: 0,
          locals: [],
          body: [{ k: "return", values: [constant("f32", Number.NEGATIVE_INFINITY)] }],
          export: "neg_inf32",
        },
        {
          sig: 1,
          locals: [],
          body: [{ k: "return", values: [constant("f64", Number.NaN)] }],
          export: "nan64",
        },
        {
          sig: 1,
          locals: [],
          body: [{ k: "return", values: [constant("f64", Number.POSITIVE_INFINITY)] }],
          export: "inf64",
        },
        {
          sig: 1,
          locals: [],
          body: [{ k: "return", values: [constant("f64", Number.NEGATIVE_INFINITY)] }],
          export: "neg_inf64",
        },
      ],
    });
    const wat = printed(module);
    assert.match(wat, /\(f32\.const nan\)/);
    assert.match(wat, /\(f32\.const inf\)/);
    assert.match(wat, /\(f32\.const -inf\)/);
    assert.match(wat, /\(f64\.const nan\)/);
    assert(Number.isNaN(runExport(module, "nan32")));
    assert.equal(runExport(module, "inf32"), Number.POSITIVE_INFINITY);
    assert.equal(runExport(module, "neg_inf32"), Number.NEGATIVE_INFINITY);
    assert(Number.isNaN(runExport(module, "nan64")));
    assert.equal(runExport(module, "inf64"), Number.POSITIVE_INFINITY);
    assert.equal(runExport(module, "neg_inf64"), Number.NEGATIVE_INFINITY);
  });

  maybeTest("round-trips i64 max, f64 negative zero, and canonical unsigned extremes", () => {
    const module = moduleWith({
      types: [
        { params: [], results: ["i64"] },
        { params: [], results: ["f64"] },
        { params: [], results: ["i32"] },
      ],
      funcs: [
        {
          sig: 0,
          locals: [],
          body: [{ k: "return", values: [constant("i64", (1n << 63n) - 1n)] }],
          export: "i64_max",
        },
        {
          sig: 1,
          locals: [],
          body: [{ k: "return", values: [constant("f64", -0)] }],
          export: "negative_zero",
        },
        {
          sig: 2,
          locals: [],
          body: [{ k: "return", values: [constant("i32", -1)] }],
          export: "u32_max",
        },
        {
          sig: 0,
          locals: [],
          body: [{ k: "return", values: [constant("i64", -1n)] }],
          export: "u64_max",
        },
      ],
    });
    const wat = printed(module);
    assert.match(wat, /\(i64\.const 9223372036854775807\)/);
    assert.match(wat, /\(f64\.const -0\)/);
    assert.equal(runExport(module, "i64_max"), (1n << 63n) - 1n);
    assert(Object.is(runExport(module, "negative_zero"), -0));
    assert.equal((runExport(module, "u32_max") as number) >>> 0, 0xffff_ffff);
    assert.equal(BigInt.asUintN(64, runExport(module, "u64_max") as bigint), (1n << 64n) - 1n);
  });
});

describe("IR WAT printer: opcode exhaustiveness", () => {
  const binops: Array<{
    op: BinOp;
    type: IrType;
    signed: boolean;
    opcode: string;
    result?: IrType;
  }> = [
    { op: "add", type: "i32", signed: true, opcode: "i32.add" },
    { op: "sub", type: "i64", signed: true, opcode: "i64.sub" },
    { op: "mul", type: "f32", signed: true, opcode: "f32.mul" },
    { op: "div", type: "i32", signed: true, opcode: "i32.div_s" },
    { op: "rem", type: "i64", signed: false, opcode: "i64.rem_u" },
    { op: "and", type: "i32", signed: false, opcode: "i32.and" },
    { op: "or", type: "i64", signed: false, opcode: "i64.or" },
    { op: "xor", type: "i32", signed: false, opcode: "i32.xor" },
    { op: "shl", type: "i64", signed: false, opcode: "i64.shl" },
    { op: "shr", type: "i32", signed: false, opcode: "i32.shr_u" },
    { op: "eq", type: "f64", signed: true, opcode: "f64.eq", result: "i32" },
    { op: "ne", type: "i64", signed: true, opcode: "i64.ne", result: "i32" },
    { op: "lt", type: "i32", signed: true, opcode: "i32.lt_s", result: "i32" },
    { op: "le", type: "i64", signed: false, opcode: "i64.le_u", result: "i32" },
    { op: "gt", type: "f32", signed: true, opcode: "f32.gt", result: "i32" },
    { op: "ge", type: "i32", signed: false, opcode: "i32.ge_u", result: "i32" },
    { op: "copysign", type: "f64", signed: true, opcode: "f64.copysign" },
  ];

  for (const entry of binops) {
    test(`prints ${entry.op} as ${entry.opcode}`, () => {
      const module = expressionModule(
        {
          k: "binop",
          op: entry.op,
          type: entry.type,
          signed: entry.signed,
          l: constant(entry.type, entry.type === "i64" ? 4n : 4),
          r: constant(entry.type, entry.type === "i64" ? 2n : 2),
        },
        entry.result ?? entry.type,
      );
      assert.match(printed(module), new RegExp(`\\(${entry.opcode.replace(".", "\\.")} `));
    });
  }

  const unops: Array<{ op: UnOp; type: IrType; opcode: string; result?: IrType }> = [
    { op: "eqz", type: "i64", opcode: "i64.eqz", result: "i32" },
    { op: "neg", type: "f32", opcode: "f32.neg" },
    { op: "abs", type: "f64", opcode: "f64.abs" },
    { op: "sqrt", type: "f32", opcode: "f32.sqrt" },
    { op: "floor", type: "f64", opcode: "f64.floor" },
    { op: "ceil", type: "f32", opcode: "f32.ceil" },
    { op: "trunc", type: "f64", opcode: "f64.trunc" },
    { op: "nearest", type: "f32", opcode: "f32.nearest" },
  ];

  for (const entry of unops) {
    test(`prints ${entry.op} as ${entry.opcode}`, () => {
      const module = expressionModule(
        {
          k: "unop",
          op: entry.op,
          type: entry.type,
          e: constant(entry.type, entry.type === "i64" ? 4n : 4),
        },
        entry.result ?? entry.type,
      );
      assert.match(printed(module), new RegExp(`\\(${entry.opcode.replace(".", "\\.")} `));
    });
  }

  const conversions: Array<{ op: ConvOp; source: IrType; result: IrType }> = [
    { op: "i32.wrap_i64", source: "i64", result: "i32" },
    { op: "i64.extend_i32_s", source: "i32", result: "i64" },
    { op: "i64.extend_i32_u", source: "i32", result: "i64" },
    { op: "i32.trunc_f32_s", source: "f32", result: "i32" },
    { op: "i32.trunc_f32_u", source: "f32", result: "i32" },
    { op: "i32.trunc_f64_s", source: "f64", result: "i32" },
    { op: "i32.trunc_f64_u", source: "f64", result: "i32" },
    { op: "i64.trunc_f32_s", source: "f32", result: "i64" },
    { op: "i64.trunc_f32_u", source: "f32", result: "i64" },
    { op: "i64.trunc_f64_s", source: "f64", result: "i64" },
    { op: "i64.trunc_f64_u", source: "f64", result: "i64" },
    { op: "f32.convert_i32_s", source: "i32", result: "f32" },
    { op: "f32.convert_i32_u", source: "i32", result: "f32" },
    { op: "f32.convert_i64_s", source: "i64", result: "f32" },
    { op: "f32.convert_i64_u", source: "i64", result: "f32" },
    { op: "f64.convert_i32_s", source: "i32", result: "f64" },
    { op: "f64.convert_i32_u", source: "i32", result: "f64" },
    { op: "f64.convert_i64_s", source: "i64", result: "f64" },
    { op: "f64.convert_i64_u", source: "i64", result: "f64" },
    { op: "f32.demote_f64", source: "f64", result: "f32" },
    { op: "f64.promote_f32", source: "f32", result: "f64" },
    { op: "i32.extend8_s", source: "i32", result: "i32" },
    { op: "i32.extend16_s", source: "i32", result: "i32" },
    { op: "i64.extend8_s", source: "i64", result: "i64" },
    { op: "i64.extend16_s", source: "i64", result: "i64" },
    { op: "i64.extend32_s", source: "i64", result: "i64" },
  ];

  for (const entry of conversions) {
    test(`prints conversion ${entry.op}`, () => {
      const value = entry.source === "i64" ? 1n : 1;
      const module = expressionModule(
        { k: "convert", op: entry.op, e: constant(entry.source, value) },
        entry.result,
      );
      assert.match(printed(module), new RegExp(`\\(${entry.op.replace(".", "\\.")} `));
    });
  }
});

describe("IR WAT printer: memory access exhaustiveness", () => {
  const loads: Array<{ type: IrType; width?: 8 | 16; signed?: boolean; opcode: string }> = [
    { type: "i32", opcode: "i32.load" },
    { type: "i64", opcode: "i64.load" },
    { type: "f32", opcode: "f32.load" },
    { type: "f64", opcode: "f64.load" },
    { type: "i32", width: 8, signed: true, opcode: "i32.load8_s" },
    { type: "i32", width: 8, signed: false, opcode: "i32.load8_u" },
    { type: "i32", width: 16, signed: true, opcode: "i32.load16_s" },
    { type: "i32", width: 16, signed: false, opcode: "i32.load16_u" },
    { type: "i64", width: 8, signed: true, opcode: "i64.load8_s" },
    { type: "i64", width: 8, signed: false, opcode: "i64.load8_u" },
    { type: "i64", width: 16, signed: true, opcode: "i64.load16_s" },
    { type: "i64", width: 16, signed: false, opcode: "i64.load16_u" },
  ];

  for (const entry of loads) {
    test(`prints ${entry.opcode}`, () => {
      const load: Expr = {
        k: "load",
        type: entry.type,
        addr: constant("i32"),
        offset: 17,
        ...(entry.width === undefined ? {} : { width: entry.width, signed: entry.signed! }),
      };
      assert.match(
        printed(expressionModule(load, entry.type)),
        new RegExp(entry.opcode.replace(".", "\\.")),
      );
    });
  }

  const stores: Array<{ type: IrType; width?: 8 | 16; opcode: string }> = [
    { type: "i32", opcode: "i32.store" },
    { type: "i64", opcode: "i64.store" },
    { type: "f32", opcode: "f32.store" },
    { type: "f64", opcode: "f64.store" },
    { type: "i32", width: 8, opcode: "i32.store8" },
    { type: "i32", width: 16, opcode: "i32.store16" },
    { type: "i64", width: 8, opcode: "i64.store8" },
    { type: "i64", width: 16, opcode: "i64.store16" },
  ];

  for (const entry of stores) {
    test(`prints ${entry.opcode}`, () => {
      const store: Stmt = {
        k: "store",
        type: entry.type,
        addr: constant("i32"),
        value: constant(entry.type),
        offset: 19,
        ...(entry.width === undefined ? {} : { width: entry.width }),
      };
      assert.match(printed(statementModule(store)), new RegExp(entry.opcode.replace(".", "\\.")));
    });
  }
});

describe("IR WAT printer: node-kind and call-shape exhaustiveness", () => {
  const simpleExpressions: Array<{ name: string; module: () => IrModule; needle: RegExp }> = [
    {
      name: "const",
      module: () => expressionModule(constant("i32", 1), "i32"),
      needle: /\(i32\.const 1\)/,
    },
    {
      name: "local.get",
      module: () =>
        moduleWith({
          types: [{ params: ["i32"], results: ["i32"] }],
          funcs: [
            { sig: 0, locals: [], body: [{ k: "return", values: [{ k: "local.get", id: 0 }] }] },
          ],
        }),
      needle: /\(local\.get \$l0\)/,
    },
    {
      name: "global.get",
      module: () =>
        moduleWith({
          types: [{ params: [], results: ["i32"] }],
          funcs: [
            { sig: 0, locals: [], body: [{ k: "return", values: [{ k: "global.get", id: 0 }] }] },
          ],
          globals: [{ type: "i32", mutable: false, init: { k: "const", type: "i32", value: 0 } }],
        }),
      needle: /\(global\.get \$g0\)/,
    },
    {
      name: "if_val",
      module: () =>
        expressionModule(
          {
            k: "if_val",
            cond: constant("i32", 1),
            then: constant("i32", 2),
            else: constant("i32", 3),
            type: "i32",
          },
          "i32",
        ),
      needle: /\(if \(result i32\)/,
    },
    {
      name: "seq",
      module: () =>
        expressionModule(
          { k: "seq", stmts: [{ k: "drop", e: constant("i32") }], value: constant("i32", 1) },
          "i32",
        ),
      needle: /\(block \(result i32\)/,
    },
    {
      name: "memory.size",
      module: () => expressionModule({ k: "memory.size" }, "i32"),
      needle: /\(memory\.size\)/,
    },
    {
      name: "memory.grow",
      module: () => expressionModule({ k: "memory.grow", pages: constant("i32") }, "i32"),
      needle: /\(memory\.grow /,
    },
  ];

  for (const entry of simpleExpressions) {
    test(`prints expression kind ${entry.name}`, () =>
      assert.match(printed(entry.module()), entry.needle));
  }

  const simpleStatements: Array<{ name: string; module: () => IrModule; needle: RegExp }> = [
    {
      name: "local.set",
      module: () => statementModule({ k: "local.set", id: 0, e: constant("i32") }, ["i32"]),
      needle: /\(local\.set \$l0 /,
    },
    {
      name: "global.set",
      module: () => {
        const module = statementModule({ k: "global.set", id: 0, e: constant("i32") });
        module.globals = [
          { type: "i32", mutable: true, init: { k: "const", type: "i32", value: 0 } },
        ];
        return module;
      },
      needle: /\(global\.set \$g0 /,
    },
    {
      name: "store",
      module: () =>
        statementModule({
          k: "store",
          type: "i32",
          addr: constant("i32"),
          value: constant("i32"),
          offset: 0,
        }),
      needle: /\(i32\.store /,
    },
    {
      name: "drop",
      module: () => statementModule({ k: "drop", e: constant("i32") }),
      needle: /\(drop /,
    },
    {
      name: "if",
      module: () => statementModule({ k: "if", cond: constant("i32"), then: [], else: [] }),
      needle: /\(if /,
    },
    {
      name: "block",
      module: () => statementModule({ k: "block", label: 1, body: [] }),
      needle: /\(block \$L0/,
    },
    {
      name: "loop",
      module: () => statementModule({ k: "loop", label: 1, body: [] }),
      needle: /\(loop \$L0/,
    },
    {
      name: "br",
      module: () => statementModule({ k: "block", label: 1, body: [{ k: "br", label: 1 }] }),
      needle: /\(br \$L0\)/,
    },
    {
      name: "br_if",
      module: () =>
        statementModule({
          k: "block",
          label: 1,
          body: [{ k: "br_if", label: 1, cond: constant("i32") }],
        }),
      needle: /\(br_if \$L0 /,
    },
    {
      name: "return",
      module: () => statementModule({ k: "return", values: [] }),
      needle: /\(return\)/,
    },
    {
      name: "unreachable",
      module: () => statementModule({ k: "unreachable" }),
      needle: /\(unreachable\)/,
    },
    {
      name: "memory.copy",
      module: () =>
        statementModule({
          k: "memory.copy",
          dest: constant("i32"),
          src: constant("i32"),
          len: constant("i32"),
        }),
      needle: /\(memory\.copy /,
    },
  ];

  for (const entry of simpleStatements) {
    test(`prints statement kind ${entry.name}`, () =>
      assert.match(printed(entry.module()), entry.needle));
  }

  const callModules: Array<{ name: string; module: () => IrModule; needle: RegExp }> = [
    {
      name: "direct zero-result call",
      module: () =>
        moduleWith({
          funcs: [
            { sig: 0, locals: [], body: [] },
            { sig: 0, locals: [], body: [{ k: "call", fn: 0, args: [] }] },
          ],
        }),
      needle: /\(call \$f0\)/,
    },
    {
      name: "direct one-result call",
      module: () =>
        moduleWith({
          types: [{ params: [], results: ["i32"] }],
          funcs: [
            { sig: 0, locals: [], body: [{ k: "return", values: [constant("i32", 1)] }] },
            {
              sig: 0,
              locals: [],
              body: [{ k: "return", values: [{ k: "call", fn: 0, args: [] }] }],
            },
          ],
        }),
      needle: /\(call \$f0\)/,
    },
    {
      name: "direct multi-result call",
      module: () =>
        moduleWith({
          types: [
            { params: [], results: ["i32", "i64"] },
            { params: [], results: [] },
          ],
          funcs: [
            {
              sig: 0,
              locals: [],
              body: [{ k: "return", values: [constant("i32"), constant("i64")] }],
            },
            {
              sig: 1,
              locals: [],
              body: [{ k: "multi_call", callee: { kind: "func", fn: 0 }, args: [], targets: null }],
            },
          ],
        }),
      needle: /\(call \$f0\)/,
    },
    {
      name: "indirect zero-result call",
      module: () =>
        moduleWith({
          funcs: [
            { sig: 0, locals: [], body: [] },
            {
              sig: 0,
              locals: [],
              body: [{ k: "call_indirect", sig: 0, index: constant("i32"), args: [] }],
            },
          ],
          table: { entries: [0] },
        }),
      needle: /\(call_indirect \(type \$t0\) \(i32\.const 0\)\)/,
    },
    {
      name: "indirect one-result call",
      module: () =>
        moduleWith({
          types: [{ params: [], results: ["i32"] }],
          funcs: [
            { sig: 0, locals: [], body: [{ k: "return", values: [constant("i32")] }] },
            {
              sig: 0,
              locals: [],
              body: [
                {
                  k: "return",
                  values: [{ k: "call_indirect", sig: 0, index: constant("i32"), args: [] }],
                },
              ],
            },
          ],
          table: { entries: [0] },
        }),
      needle: /\(call_indirect \(type \$t0\) \(i32\.const 0\)\)/,
    },
    {
      name: "indirect multi-result call",
      module: () =>
        moduleWith({
          types: [
            { params: [], results: ["i32", "i64"] },
            { params: [], results: [] },
          ],
          funcs: [
            {
              sig: 0,
              locals: [],
              body: [{ k: "return", values: [constant("i32"), constant("i64")] }],
            },
            {
              sig: 1,
              locals: [],
              body: [
                {
                  k: "multi_call",
                  callee: { kind: "indirect", sig: 0, index: constant("i32") },
                  args: [],
                  targets: null,
                },
              ],
            },
          ],
          table: { entries: [0] },
        }),
      needle: /\(call_indirect \(type \$t0\) \(i32\.const 0\)\)/,
    },
  ];

  for (const entry of callModules) {
    test(`prints ${entry.name}`, () => assert.match(printed(entry.module()), entry.needle));
  }
});

test("IR WAT printer throws on unknown expression and statement kinds", () => {
  const expression = expressionModule({ k: "mystery" } as never, "i32");
  assert.throws(() => printWat(expression), /unknown IR expression kind: mystery/);
  const statement = statementModule({ k: "mystery" } as never);
  assert.throws(() => printWat(statement), /unknown IR statement kind: mystery/);
});
