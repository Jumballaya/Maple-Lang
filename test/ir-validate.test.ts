// biome-ignore-all lint/suspicious/noThenProperty: IR branch nodes intentionally use `then`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { printValidatedModule } from "../src/compiler/compiler";
import type { ConvOp, Expr, IrModule, IrType, Stmt } from "../src/ir/ir";
import { validateModule } from "../src/ir/validate";

function i32(value = 0): Expr {
  return { k: "const", type: "i32", value };
}

function i64(value = 0n): Expr {
  return { k: "const", type: "i64", value };
}

function f32(value = 0): Expr {
  return { k: "const", type: "f32", value };
}

function constant(type: IrType): Expr {
  if (type === "i32") return i32();
  if (type === "i64") return i64();
  return { k: "const", type, value: 0 };
}

function validModule(): IrModule {
  return {
    types: [
      { params: [], results: [] },
      { params: [], results: ["i32"] },
      { params: ["i32", "i64"], results: ["i32", "i64"] },
    ],
    funcImports: [],
    globalImports: [],
    funcs: [
      {
        sig: 1,
        locals: [],
        body: [
          {
            k: "return",
            values: [
              {
                k: "binop",
                op: "add",
                type: "i32",
                signed: true,
                l: i32(20),
                r: i32(22),
              },
            ],
          },
        ],
        export: "answer_fn",
      },
      { sig: 0, locals: [], body: [] },
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
    ],
    globals: [
      {
        type: "i32",
        mutable: false,
        init: { k: "const", type: "i32", value: 7 },
        export: "answer_global",
      },
    ],
    memory: { initialPages: 2, mode: "owned" },
    table: { entries: [0] },
    data: [{ addr: 65_536, bytes: new Uint8Array([1, 2, 3]) }],
    dataEnd: 65_539,
    structLayouts: new Map([
      [
        "Point",
        {
          size: 8,
          align: 4,
          members: [
            { name: "x", offset: 0, mapleType: "i32", lane: "i32" },
            { name: "y", offset: 4, mapleType: "i32", lane: "i32" },
          ],
        },
      ],
    ]),
    start: 1,
    names: {
      funcs: new Map([
        [0, "answer"],
        [1, "start"],
        [2, "pair"],
      ]),
      globals: new Map([[0, "answer_global"]]),
      locals: new Map([
        [0, new Map()],
        [1, new Map()],
        [
          2,
          new Map([
            [0, "left"],
            [1, "right"],
          ]),
        ],
      ]),
    },
  };
}

function cloneModule(): IrModule {
  return structuredClone(validModule());
}

function resultExpr(module: IrModule): Expr {
  return (module.funcs[0]!.body[0] as Extract<Stmt, { k: "return" }>).values[0]!;
}

function setResultExpr(module: IrModule, expression: Expr): void {
  (module.funcs[0]!.body[0] as Extract<Stmt, { k: "return" }>).values[0] = expression;
}

function errorsAfter(mutate: (module: IrModule) => void): string[] {
  const module = cloneModule();
  mutate(module);
  return validateModule(module);
}

function expectError(expected: string, mutate: (module: IrModule) => void): void {
  const errors = errorsAfter(mutate);
  assert(
    errors.includes(expected),
    `Expected ${JSON.stringify(expected)} in:\n${errors.join("\n")}`,
  );
}

describe("IR validator: valid modules", () => {
  test("the backend validates after running its pass hook", () => {
    assert.throws(
      () =>
        printValidatedModule(validModule(), [
          (module) => {
            module.memory.initialPages = 0;
          },
        ]),
      {
        message: /IR validation failed:\nmemory initialPages must be at least 1/,
      },
    );
  });

  test("accepts arithmetic, exports, data, a populated table, and start", () => {
    assert.deepEqual(validateModule(validModule()), []);
  });

  test("accepts an explicitly empty table", () => {
    const module = validModule();
    module.table = { entries: [] };
    assert.deepEqual(validateModule(module), []);
  });

  test("accepts if_val, seq, and direct and indirect multi_call", () => {
    const module = validModule();
    module.funcs[1]!.locals = ["i32", "i64", "i32", "i64"];
    module.funcs[1]!.body = [
      {
        k: "multi_call",
        callee: { kind: "func", fn: 2 },
        args: [i32(1), i64(2n)],
        targets: [0, 1],
      },
      {
        k: "multi_call",
        callee: { kind: "indirect", sig: 2, index: i32() },
        args: [i32(3), i64(4n)],
        targets: [2, 3],
      },
      {
        k: "drop",
        e: {
          k: "seq",
          stmts: [{ k: "block", label: 4, body: [{ k: "br", label: 4 }] }],
          value: {
            k: "if_val",
            cond: i32(1),
            then: i32(2),
            else: i32(3),
            type: "i32",
          },
        },
      },
    ];
    assert.deepEqual(validateModule(module), []);
  });

  test("accepts the maximum legal offset and canonical unsigned constants", () => {
    const module = validModule();
    module.funcs[1]!.body = [
      {
        k: "drop",
        e: {
          k: "load",
          type: "i32",
          addr: i32(),
          offset: 0xffff_ffff,
        },
      },
      { k: "drop", e: { k: "const", type: "i32", value: -1 } },
      { k: "drop", e: { k: "const", type: "i64", value: -1n } },
    ];
    assert.deepEqual(validateModule(module), []);
  });

  test("accepts all conversion source and result lane pairs", () => {
    const cases: Array<{ op: ConvOp; source: IrType; result: IrType }> = [
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
    const module = validModule();
    module.funcs[1]!.locals = cases.map(({ result }) => result);
    module.funcs[1]!.body = cases.map(({ op, source }, id) => ({
      k: "local.set",
      id,
      e: { k: "convert", op, e: constant(source) },
    }));
    assert.deepEqual(validateModule(module), []);
  });

  test("accepts a result function ending in a fully terminating if", () => {
    const module = validModule();
    module.funcs[0]!.body = [
      {
        k: "if",
        cond: i32(1),
        then: [{ k: "return", values: [i32(1)] }],
        else: [{ k: "unreachable" }],
      },
    ];
    assert.deepEqual(validateModule(module), []);
  });
});

describe("IR validator: index spaces and labels", () => {
  const rows: Array<{
    name: string;
    expected: string;
    mutate: (module: IrModule) => void;
  }> = [
    {
      name: "rejects an out-of-range function signature",
      expected: "signature id 99 is out of range",
      mutate: (module) => {
        module.funcs[0]!.sig = 99;
      },
    },
    {
      name: "rejects an out-of-range import signature",
      expected: "signature id 99 is out of range",
      mutate: (module) => {
        module.funcImports.push({ module: "env", name: "f", sig: 99 });
      },
    },
    {
      name: "rejects an out-of-range function id",
      expected: "function id 99 is out of range",
      mutate: (module) => {
        setResultExpr(module, { k: "call", fn: 99, args: [] });
      },
    },
    {
      name: "rejects an out-of-range global id",
      expected: "global id 99 is out of range",
      mutate: (module) => {
        setResultExpr(module, { k: "global.get", id: 99 });
      },
    },
    {
      name: "rejects an out-of-range local id",
      expected: "local id 99 is out of range",
      mutate: (module) => {
        setResultExpr(module, { k: "local.get", id: 99 });
      },
    },
    {
      name: "rejects an out-of-range indirect signature",
      expected: "signature id 99 is out of range",
      mutate: (module) => {
        setResultExpr(module, { k: "call_indirect", sig: 99, index: i32(), args: [] });
      },
    },
    {
      name: "rejects a non-enclosing label",
      expected: "branch target label 8 is not enclosing",
      mutate: (module) => {
        module.funcs[1]!.body = [{ k: "br", label: 8 }];
      },
    },
    {
      name: "rejects a sibling label target",
      expected: "branch target label 1 is not enclosing",
      mutate: (module) => {
        module.funcs[1]!.body = [
          { k: "block", label: 1, body: [] },
          { k: "block", label: 2, body: [{ k: "br", label: 1 }] },
        ];
      },
    },
    {
      name: "rejects duplicate labels in a function",
      expected: "label id 1 is duplicated",
      mutate: (module) => {
        module.funcs[1]!.body = [
          { k: "block", label: 1, body: [] },
          { k: "loop", label: 1, body: [] },
        ];
      },
    },
    {
      name: "rejects a malformed label id",
      expected: "label id -1 must be a non-negative integer",
      mutate: (module) => {
        module.funcs[1]!.body = [{ k: "block", label: -1, body: [] }];
      },
    },
    {
      name: "rejects a seq branch to an outer label",
      expected: "branch target label 1 escapes seq",
      mutate: (module) => {
        module.funcs[1]!.body = [
          {
            k: "block",
            label: 1,
            body: [{ k: "drop", e: { k: "seq", stmts: [{ k: "br", label: 1 }], value: i32() } }],
          },
        ];
      },
    },
    {
      name: "rejects an out-of-range function name id",
      expected: "function id 99 is out of range",
      mutate: (module) => {
        module.names.funcs.set(99, "bad");
      },
    },
    {
      name: "rejects an out-of-range global name id",
      expected: "global id 99 is out of range",
      mutate: (module) => {
        module.names.globals.set(99, "bad");
      },
    },
    {
      name: "rejects an out-of-range local name id",
      expected: "local id 99 is out of range",
      mutate: (module) => {
        module.names.locals.get(0)!.set(99, "bad");
      },
    },
  ];

  for (const row of rows) test(row.name, () => expectError(row.expected, row.mutate));
});

describe("IR validator: expression typing", () => {
  test("reports a nested load mismatch at the binop", () => {
    expectError("binop add left operand must be i32, got i64", (module) => {
      setResultExpr(module, {
        k: "binop",
        op: "add",
        type: "i32",
        signed: true,
        l: { k: "load", type: "i64", addr: i32(), offset: 0 },
        r: i32(),
      });
    });
  });

  test("comparison expressions synthesize i32 rather than their operand lane", () => {
    expectError("binop add left operand must be i64, got i32", (module) => {
      setResultExpr(module, {
        k: "binop",
        op: "add",
        type: "i64",
        signed: true,
        l: {
          k: "binop",
          op: "lt",
          type: "i64",
          signed: true,
          l: i64(),
          r: i64(1n),
        },
        r: i64(),
      });
    });
  });

  const rows: Array<{
    name: string;
    expected: string;
    expression: Expr;
  }> = [
    {
      name: "rejects a right binop operand mismatch",
      expected: "binop add right operand must be i32, got f32",
      expression: {
        k: "binop",
        op: "add",
        type: "i32",
        signed: true,
        l: i32(),
        r: f32(),
      },
    },
    {
      name: "rejects integer-only binops on floats",
      expected: "binop rem requires an integer lane",
      expression: {
        k: "binop",
        op: "rem",
        type: "f32",
        signed: true,
        l: f32(),
        r: f32(),
      },
    },
    {
      name: "rejects copysign on integers",
      expected: "binop copysign requires a float lane",
      expression: {
        k: "binop",
        op: "copysign",
        type: "i32",
        signed: true,
        l: i32(),
        r: i32(),
      },
    },
    {
      name: "rejects eqz on floats",
      expected: "unop eqz requires an integer lane",
      expression: { k: "unop", op: "eqz", type: "f32", e: f32() },
    },
    {
      name: "rejects float unary ops on integers",
      expected: "unop sqrt requires a float lane",
      expression: { k: "unop", op: "sqrt", type: "i32", e: i32() },
    },
    {
      name: "rejects a unary operand mismatch",
      expected: "unop neg operand must be f32, got f64",
      expression: {
        k: "unop",
        op: "neg",
        type: "f32",
        e: { k: "const", type: "f64", value: 1 },
      },
    },
    {
      name: "rejects a conversion source mismatch",
      expected: "convert i32.wrap_i64 operand must be i64, got i32",
      expression: { k: "convert", op: "i32.wrap_i64", e: i32() },
    },
    {
      name: "rejects a non-i32 if_val condition",
      expected: "if_val condition must be i32, got f32",
      expression: { k: "if_val", cond: f32(), then: i32(), else: i32(), type: "i32" },
    },
    {
      name: "rejects an if_val then-arm mismatch",
      expected: "if_val then arm must be i32, got f32",
      expression: { k: "if_val", cond: i32(), then: f32(), else: i32(), type: "i32" },
    },
    {
      name: "rejects an if_val else-arm mismatch",
      expected: "if_val else arm must be i32, got f32",
      expression: { k: "if_val", cond: i32(), then: i32(), else: f32(), type: "i32" },
    },
    {
      name: "rejects a non-i32 memory.grow operand",
      expected: "memory.grow pages must be i32, got i64",
      expression: { k: "memory.grow", pages: i64() },
    },
  ];

  for (const row of rows) {
    test(row.name, () =>
      expectError(row.expected, (module) => setResultExpr(module, row.expression)),
    );
  }
});

describe("IR validator: calls", () => {
  const rows: Array<{
    name: string;
    expected: string;
    mutate: (module: IrModule) => void;
  }> = [
    {
      name: "rejects an expression call with multiple results",
      expected: "expression call must have exactly one result",
      mutate: (module) => {
        setResultExpr(module, { k: "call", fn: 2, args: [i32(), i64()] });
      },
    },
    {
      name: "rejects a statement call with a result",
      expected: "statement call must have zero results",
      mutate: (module) => {
        module.funcs[1]!.body = [{ k: "call", fn: 0, args: [] }];
      },
    },
    {
      name: "rejects an indirect expression call with multiple results",
      expected: "expression call_indirect must have exactly one result",
      mutate: (module) => {
        setResultExpr(module, {
          k: "call_indirect",
          sig: 2,
          index: i32(),
          args: [i32(), i64()],
        });
      },
    },
    {
      name: "rejects an indirect statement call with results",
      expected: "statement call_indirect must have zero results",
      mutate: (module) => {
        module.funcs[1]!.body = [{ k: "call_indirect", sig: 1, index: i32(), args: [] }];
      },
    },
    {
      name: "rejects multi_call on a single-result signature",
      expected: "multi_call must have multiple results",
      mutate: (module) => {
        module.funcs[1]!.body = [
          { k: "multi_call", callee: { kind: "func", fn: 0 }, args: [], targets: null },
        ];
      },
    },
    {
      name: "rejects indirect multi_call on a single-result signature",
      expected: "multi_call must have multiple results",
      mutate: (module) => {
        module.funcs[1]!.body = [
          {
            k: "multi_call",
            callee: { kind: "indirect", sig: 1, index: i32() },
            args: [],
            targets: null,
          },
        ];
      },
    },
    {
      name: "rejects a multi_call target count mismatch",
      expected: "multi_call target count must match result count",
      mutate: (module) => {
        module.funcs[1]!.locals = ["i32"];
        module.funcs[1]!.body = [
          {
            k: "multi_call",
            callee: { kind: "func", fn: 2 },
            args: [i32(), i64()],
            targets: [0],
          },
        ];
      },
    },
    {
      name: "rejects a multi_call target type mismatch",
      expected: "multi_call target 1 must be i64, got i32",
      mutate: (module) => {
        module.funcs[1]!.locals = ["i32", "i32"];
        module.funcs[1]!.body = [
          {
            k: "multi_call",
            callee: { kind: "func", fn: 2 },
            args: [i32(), i64()],
            targets: [0, 1],
          },
        ];
      },
    },
    {
      name: "rejects a non-i32 indirect index",
      expected: "indirect call index must be i32, got i64",
      mutate: (module) => {
        setResultExpr(module, { k: "call_indirect", sig: 1, index: i64(), args: [] });
      },
    },
    {
      name: "requires a table for indirect calls",
      expected: "indirect call requires a table",
      mutate: (module) => {
        delete module.table;
        setResultExpr(module, { k: "call_indirect", sig: 1, index: i32(), args: [] });
      },
    },
    {
      name: "requires a table for indirect multi_call",
      expected: "indirect call requires a table",
      mutate: (module) => {
        delete module.table;
        module.funcs[1]!.locals = ["i32", "i64"];
        module.funcs[1]!.body = [
          {
            k: "multi_call",
            callee: { kind: "indirect", sig: 2, index: i32() },
            args: [i32(), i64()],
            targets: [0, 1],
          },
        ];
      },
    },
    {
      name: "rejects call argument arity",
      expected: "call argument count must match signature",
      mutate: (module) => {
        setResultExpr(module, { k: "call", fn: 0, args: [i32()] });
      },
    },
    {
      name: "rejects call argument types",
      expected: "call argument 0 must be i32, got f32",
      mutate: (module) => {
        module.funcs[0]!.sig = 2;
        setResultExpr(module, { k: "call", fn: 2, args: [f32(), i64()] });
      },
    },
    {
      name: "rejects indirect call argument arity",
      expected: "call_indirect argument count must match signature",
      mutate: (module) => {
        setResultExpr(module, {
          k: "call_indirect",
          sig: 1,
          index: i32(),
          args: [i32()],
        });
      },
    },
    {
      name: "rejects indirect call argument types",
      expected: "call_indirect argument 0 must be i32, got f32",
      mutate: (module) => {
        module.types[1]!.params = ["i32"];
        setResultExpr(module, {
          k: "call_indirect",
          sig: 1,
          index: i32(),
          args: [f32()],
        });
      },
    },
  ];

  for (const row of rows) test(row.name, () => expectError(row.expected, row.mutate));
});

describe("IR validator: statements and function results", () => {
  const rows: Array<{
    name: string;
    expected: string;
    mutate: (module: IrModule) => void;
  }> = [
    {
      name: "rejects local.set value mismatches",
      expected: "local.set value must be i32, got f32",
      mutate: (module) => {
        module.funcs[1]!.locals = ["i32"];
        module.funcs[1]!.body = [{ k: "local.set", id: 0, e: f32() }];
      },
    },
    {
      name: "rejects global.set value mismatches",
      expected: "global.set value must be i32, got f32",
      mutate: (module) => {
        module.globals[0]!.mutable = true;
        module.funcs[1]!.body = [{ k: "global.set", id: 0, e: f32() }];
      },
    },
    {
      name: "rejects mutation of a defined immutable global",
      expected: "global id 0 is immutable",
      mutate: (module) => {
        module.funcs[1]!.body = [{ k: "global.set", id: 0, e: i32() }];
      },
    },
    {
      name: "rejects mutation of an imported global",
      expected: "global id 0 is immutable",
      mutate: (module) => {
        module.globalImports.push({ module: "env", name: "g", type: "i32" });
        module.funcs[1]!.body = [{ k: "global.set", id: 0, e: i32() }];
      },
    },
    {
      name: "rejects return arity mismatches",
      expected: "return value count must match function results",
      mutate: (module) => {
        module.funcs[0]!.body = [{ k: "return", values: [] }];
      },
    },
    {
      name: "rejects return type mismatches",
      expected: "return value 0 must be i32, got f32",
      mutate: (module) => {
        module.funcs[0]!.body = [{ k: "return", values: [f32()] }];
      },
    },
    {
      name: "rejects result function fallthrough",
      expected: "function with results must end in a terminating statement",
      mutate: (module) => {
        module.funcs[0]!.body = [{ k: "drop", e: i32() }];
      },
    },
    {
      name: "rejects an if without two terminating arms at function end",
      expected: "function with results must end in a terminating statement",
      mutate: (module) => {
        module.funcs[0]!.body = [
          { k: "if", cond: i32(), then: [{ k: "return", values: [i32()] }] },
        ];
      },
    },
    {
      name: "rejects non-i32 if conditions",
      expected: "if condition must be i32, got f32",
      mutate: (module) => {
        module.funcs[1]!.body = [{ k: "if", cond: f32(), then: [] }];
      },
    },
    {
      name: "rejects non-i32 br_if conditions",
      expected: "br_if condition must be i32, got i64",
      mutate: (module) => {
        module.funcs[1]!.body = [
          { k: "block", label: 1, body: [{ k: "br_if", label: 1, cond: i64() }] },
        ];
      },
    },
    {
      name: "rejects non-i32 memory.copy operands",
      expected: "memory.copy src must be i32, got i64",
      mutate: (module) => {
        module.funcs[1]!.body = [{ k: "memory.copy", dest: i32(), src: i64(), len: i32() }];
      },
    },
    {
      name: "rejects a non-i32 memory.copy destination",
      expected: "memory.copy dest must be i32, got i64",
      mutate: (module) => {
        module.funcs[1]!.body = [{ k: "memory.copy", dest: i64(), src: i32(), len: i32() }];
      },
    },
    {
      name: "rejects a non-i32 memory.copy length",
      expected: "memory.copy len must be i32, got i64",
      mutate: (module) => {
        module.funcs[1]!.body = [{ k: "memory.copy", dest: i32(), src: i32(), len: i64() }];
      },
    },
  ];

  for (const row of rows) test(row.name, () => expectError(row.expected, row.mutate));
});

describe("IR validator: memory access", () => {
  const rows: Array<{
    name: string;
    expected: string;
    mutate: (module: IrModule) => void;
  }> = [
    {
      name: "rejects narrow float loads",
      expected: "load width requires an integer lane",
      mutate: (module) => {
        setResultExpr(module, {
          k: "load",
          type: "f32",
          width: 8,
          signed: false,
          addr: i32(),
          offset: 0,
        });
      },
    },
    {
      name: "requires signedness on narrow loads",
      expected: "narrow load requires signed",
      mutate: (module) => {
        setResultExpr(module, { k: "load", type: "i32", width: 8, addr: i32(), offset: 0 } as Expr);
      },
    },
    {
      name: "rejects signedness on full-width loads",
      expected: "full-width load must not specify signed",
      mutate: (module) => {
        setResultExpr(module, {
          k: "load",
          type: "i32",
          signed: false,
          addr: i32(),
          offset: 0,
        } as Expr);
      },
    },
    {
      name: "requires boolean load signedness",
      expected: "load signed must be boolean",
      mutate: (module) => {
        setResultExpr(module, {
          k: "load",
          type: "i32",
          width: 8,
          signed: 0,
          addr: i32(),
          offset: 0,
        } as unknown as Expr);
      },
    },
    {
      name: "rejects unsupported load widths",
      expected: "load width must be 8 or 16",
      mutate: (module) => {
        setResultExpr(module, {
          k: "load",
          type: "i32",
          width: 32,
          signed: false,
          addr: i32(),
          offset: 0,
        } as unknown as Expr);
      },
    },
    {
      name: "requires i32 load addresses",
      expected: "load address must be i32, got i64",
      mutate: (module) => {
        setResultExpr(module, { k: "load", type: "i32", addr: i64(), offset: 0 });
      },
    },
    {
      name: "rejects narrow float stores",
      expected: "store width requires an integer lane",
      mutate: (module) => {
        module.funcs[1]!.body = [
          { k: "store", type: "f32", width: 8, addr: i32(), value: f32(), offset: 0 },
        ];
      },
    },
    {
      name: "requires i32 store addresses",
      expected: "store address must be i32, got i64",
      mutate: (module) => {
        module.funcs[1]!.body = [{ k: "store", type: "i32", addr: i64(), value: i32(), offset: 0 }];
      },
    },
    {
      name: "requires store value types to match",
      expected: "store value must be i32, got f32",
      mutate: (module) => {
        module.funcs[1]!.body = [{ k: "store", type: "i32", addr: i32(), value: f32(), offset: 0 }];
      },
    },
    {
      name: "rejects unsupported store widths",
      expected: "store width must be 8 or 16",
      mutate: (module) => {
        module.funcs[1]!.body = [
          {
            k: "store",
            type: "i32",
            width: 32,
            addr: i32(),
            value: i32(),
            offset: 0,
          } as unknown as Stmt,
        ];
      },
    },
    {
      name: "rejects negative load offsets",
      expected: "load offset must be an unsigned 32-bit integer",
      mutate: (module) => {
        setResultExpr(module, { k: "load", type: "i32", addr: i32(), offset: -1 });
      },
    },
    {
      name: "rejects load offsets above u32 max",
      expected: "load offset must be an unsigned 32-bit integer",
      mutate: (module) => {
        setResultExpr(module, {
          k: "load",
          type: "i32",
          addr: i32(),
          offset: 0x1_0000_0000,
        });
      },
    },
    {
      name: "rejects fractional store offsets",
      expected: "store offset must be an unsigned 32-bit integer",
      mutate: (module) => {
        module.funcs[1]!.body = [
          { k: "store", type: "i32", addr: i32(), value: i32(), offset: 0.5 },
        ];
      },
    },
  ];

  for (const row of rows) test(row.name, () => expectError(row.expected, row.mutate));
});

describe("IR validator: module shape", () => {
  const rows: Array<{
    name: string;
    expected: string;
    mutate: (module: IrModule) => void;
  }> = [
    {
      name: "rejects duplicate signature shapes",
      expected: "signature 3 duplicates signature 1",
      mutate: (module) => {
        module.types.push({ params: [], results: ["i32"] });
      },
    },
    {
      name: "rejects duplicate export names",
      expected: 'export name "answer_fn" is duplicated',
      mutate: (module) => {
        module.globals[0]!.export = "answer_fn";
      },
    },
    {
      name: "includes owned memory in export uniqueness",
      expected: 'export name "memory" is duplicated',
      mutate: (module) => {
        module.funcs[0]!.export = "memory";
      },
    },
    {
      name: "requires a [] -> [] start signature",
      expected: "start function must have signature [] -> []",
      mutate: (module) => {
        module.start = 0;
      },
    },
    {
      name: "rejects invalid table entries",
      expected: "function id 99 is out of range",
      mutate: (module) => {
        module.table!.entries = [99];
      },
    },
    {
      name: "requires global const initializers",
      expected: "global initializer must be a const expression",
      mutate: (module) => {
        module.globals[0]!.init = { k: "global.get", id: 0 } as never;
      },
    },
    {
      name: "requires global initializer types to match",
      expected: "global initializer must have type i32, got f32",
      mutate: (module) => {
        module.globals[0]!.init = { k: "const", type: "f32", value: 1 };
      },
    },
  ];

  for (const row of rows) test(row.name, () => expectError(row.expected, row.mutate));
});

describe("IR validator: data and memory bounds", () => {
  const rows: Array<{
    name: string;
    expected: string;
    mutate: (module: IrModule) => void;
  }> = [
    {
      name: "requires an integer initial page count",
      expected: "memory initialPages must be an integer",
      mutate: (module) => {
        module.memory.initialPages = 1.5;
      },
    },
    {
      name: "requires at least one memory page",
      expected: "memory initialPages must be at least 1",
      mutate: (module) => {
        module.memory.initialPages = 0;
      },
    },
    {
      name: "rejects more than 65536 memory pages",
      expected: "memory initialPages must not exceed 65536",
      mutate: (module) => {
        module.memory.initialPages = 65_537;
      },
    },
    {
      name: "requires non-negative integer data addresses",
      expected: "data segment address must be a non-negative integer",
      mutate: (module) => {
        module.data[0]!.addr = -1;
      },
    },
    {
      name: "rejects fractional data addresses",
      expected: "data segment address must be a non-negative integer",
      mutate: (module) => {
        module.data[0]!.addr = 65_536.5;
      },
    },
    {
      name: "rejects overlapping data segments",
      expected: "data segments overlap",
      mutate: (module) => {
        module.data.push({ addr: 65_538, bytes: new Uint8Array([4, 5]) });
        module.dataEnd = 65_540;
      },
    },
    {
      name: "rejects data beyond memory",
      expected: "data segment exceeds initial memory",
      mutate: (module) => {
        module.data = [{ addr: 131_071, bytes: new Uint8Array([1, 2]) }];
        module.dataEnd = 131_073;
      },
    },
    {
      name: "requires an integer dataEnd",
      expected: "dataEnd must be an integer",
      mutate: (module) => {
        module.dataEnd = 65_539.5;
      },
    },
    {
      name: "requires dataEnd to reserve the first page",
      expected: "dataEnd must be at least 65536",
      mutate: (module) => {
        module.data = [];
        module.dataEnd = 65_535;
      },
    },
    {
      name: "requires dataEnd to cover every segment",
      expected: "dataEnd must cover every data segment",
      mutate: (module) => {
        module.dataEnd = 65_538;
      },
    },
    {
      name: "requires dataEnd to fit in initial memory",
      expected: "dataEnd exceeds initial memory",
      mutate: (module) => {
        module.dataEnd = 131_073;
      },
    },
  ];

  for (const row of rows) test(row.name, () => expectError(row.expected, row.mutate));
});

describe("IR validator: struct layouts and const shapes", () => {
  const rows: Array<{
    name: string;
    expected: string;
    mutate: (module: IrModule) => void;
  }> = [
    {
      name: "requires non-negative integer struct sizes",
      expected: "struct Point size must be a non-negative integer",
      mutate: (module) => {
        module.structLayouts.get("Point")!.size = -1;
      },
    },
    {
      name: "requires power-of-two struct alignment",
      expected: "struct Point alignment must be a positive power of two",
      mutate: (module) => {
        module.structLayouts.get("Point")!.align = 3;
      },
    },
    {
      name: "requires non-negative integer member offsets",
      expected: "struct Point member y offset must be a non-negative integer",
      mutate: (module) => {
        module.structLayouts.get("Point")!.members[1]!.offset = -1;
      },
    },
    {
      name: "requires members ordered by offset",
      expected: "struct Point members must be ordered by offset",
      mutate: (module) => {
        module.structLayouts.get("Point")!.members.reverse();
      },
    },
    {
      name: "rejects overlapping members",
      expected: "struct Point members overlap",
      mutate: (module) => {
        module.structLayouts.get("Point")!.members[1]!.offset = 2;
      },
    },
    {
      name: "requires every member to fit inside the struct",
      expected: "struct Point member y exceeds struct size",
      mutate: (module) => {
        module.structLayouts.get("Point")!.size = 7;
      },
    },
    {
      name: "rejects unsupported struct member widths",
      expected: "struct Point member x width must be 8 or 16",
      mutate: (module) => {
        module.structLayouts.get("Point")!.members[0]!.width = 32 as never;
      },
    },
    {
      name: "rejects narrow float struct members",
      expected: "struct Point member x width requires an integer lane",
      mutate: (module) => {
        const member = module.structLayouts.get("Point")!.members[0]!;
        member.lane = "f32";
        member.width = 8;
      },
    },
    {
      name: "requires canonical i32 const values",
      expected: "i32 const value must be an integer in signed 32-bit range",
      mutate: (module) => {
        setResultExpr(module, { k: "const", type: "i32", value: 0xffff_ffff });
      },
    },
    {
      name: "requires bigint i64 const values",
      expected: "i64 const value must be a bigint in signed 64-bit range",
      mutate: (module) => {
        setResultExpr(module, { k: "const", type: "i64", value: 1 as never });
      },
    },
    {
      name: "requires canonical i64 const range",
      expected: "i64 const value must be a bigint in signed 64-bit range",
      mutate: (module) => {
        setResultExpr(module, { k: "const", type: "i64", value: 1n << 63n });
      },
    },
    {
      name: "requires numeric float const values",
      expected: "f32 const value must be a number",
      mutate: (module) => {
        setResultExpr(module, { k: "const", type: "f32", value: 1n });
      },
    },
  ];

  for (const row of rows) test(row.name, () => expectError(row.expected, row.mutate));
});

test("IR validator fixture remains an ordinary expression tree", () => {
  assert.equal(resultExpr(validModule()).k, "binop");
});
