import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { linkStdlibImports } from "../src/compiler/compiler";
import type { ModuleMeta } from "../src/compiler/metadata";
import { collectFnReferences, extractModuleMeta } from "../src/compiler/module-metadata";
import { typeCheck } from "../src/compiler/TypeChecker";
import { lowerModule } from "../src/ir/lower";
import { printWat } from "../src/ir/print-wat";
import { validateModule } from "../src/ir/validate";
import type { ASTProgram } from "../src/parser/ast/ASTProgram";
import { Identifier } from "../src/parser/ast/expressions/Identifier";
import { StructLiteralExpression } from "../src/parser/ast/expressions/StructLiteralExpression";
import { FunctionStatement } from "../src/parser/ast/statements/FunctionStatement";
import { ReturnStatement } from "../src/parser/ast/statements/ReturnStatement";
import type { ASTExpression } from "../src/parser/ast/types/ast.type";
import { Parser } from "../src/parser/Parser";
import { maybeTest, runExport } from "./helpers";

type CheckedProgram = { ast: ASTProgram; meta: ModuleMeta };

function checked(source: string): CheckedProgram {
  const parser = new Parser(source, "scalar.maple");
  const ast = parser.parse("scalar");
  assert.deepEqual(
    parser.errors.map((error) => error.message),
    [],
  );
  const meta = extractModuleMeta(ast, true);
  collectFnReferences(ast, meta);
  linkStdlibImports(meta);
  assert.deepEqual(
    typeCheck(ast, meta).map((error) => error.message),
    [],
  );
  return { ast, meta };
}

function lowered(source: string): ReturnType<typeof lowerModule> & { wat: string } {
  const { ast, meta } = checked(source);
  const result = lowerModule(ast, meta, { importMemory: false });
  assert.deepEqual(validateModule(result.module), []);
  return {
    ...result,
    wat: printWat(result.module),
  };
}

function differential(source: string, exportName: string, args: (number | bigint)[] = []): unknown {
  return runExport(lowered(source).wat, exportName, args);
}

describe("IR scalar lowering: integers and casts", () => {
  maybeTest("preserves sub-word lane arithmetic and signedness", () => {
    const source = `
      export fn widened(): i32 { let x: i8 = 100; return x + x; }
      export fn masked(): i32 { return 200 as u8; }
      export fn compound(): i32 { let x: u16 = 65535; x += 2; return x; }
      export fn remEdge(): i32 { return -2147483648 % -1; }
      export fn ordering(): i32 {
        let signed: i32 = (-1 as i32) < 1;
        let unsigned: i32 = (-1 as u32) < (1 as u32);
        return signed * 10 + unsigned;
      }
    `;
    assert.equal(differential(source, "widened"), 200);
    assert.equal(differential(source, "masked"), 200);
    assert.equal(differential(source, "compound"), 65_537);
    assert.equal(differential(source, "remEdge"), 0);
    assert.equal(differential(source, "ordering"), 10);
  });

  maybeTest("covers lane conversions, literal wrapping, and traps", () => {
    const source = `
      export fn signedByte(): i32 { return 200 as i8; }
      export fn unsignedByte(): i32 { return -1 as u8; }
      export fn wideSigned(): i64 { return (-1 as i32) as i64; }
      export fn wideUnsigned(): i64 { return (-1 as u32) as i64; }
      export fn wrap64(): i32 { return (4294967297 as i64) as i32; }
      export fn i32ToF32(): f32 { return (-7 as i32) as f32; }
      export fn u32ToF32(): f32 { return (-1 as u32) as f32; }
      export fn toFloat(): f64 { return (7 as u32) as f64; }
      export fn i64ToF32(): f32 { return (-9 as i64) as f32; }
      export fn u64ToF32(): f32 { return (9 as u64) as f32; }
      export fn i64ToF64(): f64 { return (-11 as i64) as f64; }
      export fn u64ToF64(): f64 { return (11 as u64) as f64; }
      export fn promote(): f64 { return 1.5 as f64; }
      export fn demote(): f32 { return (1.5 as f64) as f32; }
      export fn truncSigned(): i32 { return -3.75 as i32; }
      export fn f64ToI32(): i32 { return (-4.75 as f64) as i32; }
      export fn f64ToU32(): u32 { return (4.75 as f64) as u32; }
      export fn f32ToI64(): i64 { return (-5.75 as f32) as i64; }
      export fn f32ToU64(): u64 { return (5.75 as f32) as u64; }
      export fn f64ToI64(): i64 { return (-6.75 as f64) as i64; }
      export fn f64ToU64(): u64 { return (6.75 as f64) as u64; }
      export fn u32Bits(): u32 { return -1 as u32; }
      export fn trapUnsigned(): u32 { return -1.5 as u32; }
    `;
    assert.equal(differential(source, "signedByte"), -56);
    assert.equal(differential(source, "unsignedByte"), 255);
    assert.equal(differential(source, "wideSigned"), -1n);
    assert.equal(differential(source, "wideUnsigned"), 4_294_967_295n);
    assert.equal(differential(source, "wrap64"), 1);
    assert.equal(differential(source, "i32ToF32"), -7);
    assert.equal(differential(source, "u32ToF32"), 4_294_967_296);
    assert.equal(differential(source, "toFloat"), 7);
    assert.equal(differential(source, "i64ToF32"), -9);
    assert.equal(differential(source, "u64ToF32"), 9);
    assert.equal(differential(source, "i64ToF64"), -11);
    assert.equal(differential(source, "u64ToF64"), 11);
    assert.equal(differential(source, "promote"), 1.5);
    assert.equal(differential(source, "demote"), 1.5);
    assert.equal(differential(source, "truncSigned"), -3);
    assert.equal(differential(source, "f64ToI32"), -4);
    assert.equal(differential(source, "f64ToU32"), 4);
    assert.equal(differential(source, "f32ToI64"), -5n);
    assert.equal(differential(source, "f32ToU64"), 5n);
    assert.equal(differential(source, "f64ToI64"), -6n);
    assert.equal(differential(source, "f64ToU64"), 6n);
    assert.equal(Number(differential(source, "u32Bits")) >>> 0, 0xffff_ffff);
    const { wat } = lowered(source);
    assert.throws(() => runExport(wat, "trapUnsigned"), WebAssembly.RuntimeError);
  });

  maybeTest("masks float-to-sub-word casts for signed and unsigned targets", () => {
    const { wat } = lowered(`
      export fn signed8(): i32 { return -1.5 as i8; }
      export fn signed16(): i32 { return -1.5 as i16; }
      export fn unsigned8(): i32 { return 257.9 as u8; }
      export fn unsigned16(): i32 { return 65537.9 as u16; }
    `);
    assert.equal(runExport(wat, "signed8"), 255);
    assert.equal(runExport(wat, "signed16"), 65_535);
    assert.equal(runExport(wat, "unsigned8"), 1);
    assert.equal(runExport(wat, "unsigned16"), 1);
  });

  maybeTest("preserves lossless i64 literals and negative zero", () => {
    const source = `
      export fn maximum(): i64 { return 9223372036854775807; }
      export fn negativeZero(): f64 { let z: f64 = -0.0; return 1.0 as f64 / z; }
    `;
    assert.equal(differential(source, "maximum"), 9_223_372_036_854_775_807n);
    assert.equal(differential(source, "negativeZero"), Number.NEGATIVE_INFINITY);
  });

  test("B14 frounds expression and global f32 literals at construction", () => {
    const { module } = lowered(`
      let positiveGlobal: f32 = 1.1;
      let negativeGlobal: f32 = -1.1;
      let negativeZeroGlobal: f32 = -0.0;
      export fn positiveExpr(): f32 { return 1.1; }
      export fn negativeExpr(): f32 { return -1.1; }
      export fn negativeZeroExpr(): f32 { return -0.0; }
    `);

    const globalValue = (name: string): number => {
      const id = [...module.names.globals].find(([, candidate]) => candidate === name)?.[0];
      assert.notEqual(id, undefined);
      return module.globals[id! - module.globalImports.length]!.init.value as number;
    };
    assert.equal(globalValue("positiveGlobal"), Math.fround(1.1));
    assert.equal(globalValue("negativeGlobal"), Math.fround(-1.1));
    assert(Object.is(globalValue("negativeZeroGlobal"), -0));

    const returnValue = (name: string) => {
      const id = [...module.names.funcs].find(([, candidate]) => candidate === name)?.[0];
      assert.notEqual(id, undefined);
      const statement = module.funcs[id! - module.funcImports.length]!.body[0]!;
      assert.equal(statement.k, "return");
      if (statement.k !== "return") assert.fail("expected return");
      return statement.values[0]!;
    };

    const positive = returnValue("positiveExpr");
    assert.equal(positive.k, "const");
    if (positive.k !== "const") assert.fail("expected const");
    assert.equal(positive.value, Math.fround(1.1));

    const negative = returnValue("negativeExpr");
    assert.equal(negative.k, "const");
    if (negative.k !== "const") assert.fail("expected const");
    assert.equal(negative.value, Math.fround(-1.1));

    const negativeZero = returnValue("negativeZeroExpr");
    assert.equal(negativeZero.k, "const");
    if (negativeZero.k !== "const") assert.fail("expected const");
    assert(Object.is(negativeZero.value, -0));
  });
});

describe("IR scalar lowering: expression evaluation", () => {
  maybeTest("short-circuits both boolean operators", () => {
    const source = `
      let count: i32 = 0;
      fn yes(): bool { count += 1; return true; }
      fn no(): bool { count += 1; return false; }
      fn rhs(): bool { count += 10; return true; }
      export fn run(): i32 {
        count = 0;
        let a: bool = yes() || rhs();
        let first: i32 = count;
        count = 0;
        let b: bool = no() && rhs();
        return first * 10 + count;
      }
    `;
    assert.equal(differential(source, "run"), 11);
  });

  maybeTest("keeps value and statement postfix forms distinct on locals and globals", () => {
    const source = `
      let global: i32 = 5;
      export fn run(): i32 {
        let local: i32 = 3;
        let oldLocal: i32 = local++;
        global++;
        let oldGlobal: i32 = global--;
        local--;
        return oldLocal * 1000 + local * 100 + oldGlobal * 10 + global;
      }
    `;
    assert.equal(differential(source, "run"), 3365);
  });

  maybeTest("evaluates float remainder operands once in left-to-right order", () => {
    const { wat } = lowered(`
      let order: i32 = 0;
      fn left(): f32 { order = order * 10 + 1; return -7.5; }
      fn right(): f32 { order = order * 10 + 2; return 2.0; }
      export fn run(): i32 { let value: f32 = left() % right(); return order; }
    `);
    assert.equal(runExport(wat, "run"), 12);
  });

  maybeTest("matches numeric f32 and f64 remainder signs", () => {
    const source = `
      export fn rem32(): f32 { return -7.5 % 2.0; }
      export fn rem64(): f64 { return (-7.5 as f64) % (2.0 as f64); }
    `;
    assert.equal(differential(source, "rem32"), Math.fround(-7.5 % 2));
    assert.equal(differential(source, "rem64"), -7.5 % 2);
  });
});

describe("IR scalar lowering: control flow", () => {
  maybeTest("targets nested while and for break/continue labels", () => {
    const source = `
      export fn run(): i32 {
        let total: i32 = 0;
        let outer: i32 = 0;
        while (outer < 4) {
          outer++;
          if (outer == 2) { continue; }
          for (let inner: i32 = 0; inner < 5; inner++) {
            if (inner == 1) { continue; }
            if (inner == 4) { break; }
            total += outer * 10 + inner;
          }
          if (outer == 3) { break; }
        }
        return total;
      }
    `;
    assert.equal(differential(source, "run"), 130);
  });

  maybeTest("switch cases never fall through", () => {
    const source = `
      export fn run(value: i32): i32 {
        let result: i32 = 1;
        switch (value) {
          case 0: { result += 10; }
          case 1: { result += 20; }
          case 2: { result += 30; }
          default: { result += 40; }
        }
        return result;
      }
    `;
    for (const [input, expected] of [
      [0, 11],
      [1, 21],
      [2, 31],
      [9, 41],
    ] as const) {
      assert.equal(differential(source, "run", [input]), expected);
    }
  });

  maybeTest("evaluates a switch selector once", () => {
    const { wat } = lowered(`
      let count: i32 = 0;
      fn selector(): i32 { count += 10; return 2; }
      export fn run(): i32 {
        switch (selector()) {
          case 0: { count += 1; }
          case 1: { count += 2; }
          case 2: { count += 3; }
          default: { count += 4; }
        }
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 13);
  });

  maybeTest("accepts a complete returning switch at a non-void tail", () => {
    const { wat } = lowered(`
      export fn run(value: i32): i32 {
        switch (value) {
          case 0: { return 10; }
          case 1: { return 20; }
          default: { return 30; }
        }
      }
    `);
    assert.equal(runExport(wat, "run", [0]), 10);
    assert.equal(runExport(wat, "run", [1]), 20);
    assert.equal(runExport(wat, "run", [9]), 30);
  });
});

describe("IR scalar lowering: calls and globals", () => {
  maybeTest("lowers direct multi-return consumption shapes", () => {
    const source = `
      let calls: i32 = 0;
      fn pair(value: i32): (i32, i64) { calls += 1; return value, value as i64; }
      fn pass(value: i32): (i32, i64) { return pair(value); }
      export fn destructure(): i32 { let (first, _) = pair(7); return first; }
      export fn discard(): i32 { pair(8); return calls; }
      export fn passthrough(value: i32): (i32, i64) { return pass(value); }
    `;
    assert.equal(differential(source, "destructure"), 7);
    assert.equal(differential(source, "discard"), 1);
    assert.deepEqual(differential(source, "passthrough", [9]), [9, 9n]);
  });

  maybeTest("drops a discarded single-result call after running its side effect", () => {
    const source = `
      let count: i32 = 0;
      fn value(): i32 { count += 1; return 99; }
      export fn run(): i32 { value(); return count; }
    `;
    assert.equal(differential(source, "run"), 1);
  });

  maybeTest("reads and mutates a scalar global across direct calls", () => {
    const source = `
      let value: i32 = 2;
      fn bump(): void { value = value * 3 + 1; }
      export fn run(): i32 { bump(); bump(); return value; }
    `;
    assert.equal(differential(source, "run"), 22);
  });

  test("makes a non-constant const global mutable and records its initializer", () => {
    const { ast, meta } = checked(`
      const A: i32 = 7;
      const B: i32 = A + 5;
      export fn run(): i32 { return B; }
    `);
    const result = lowerModule(ast, meta);
    const globalId = [...result.module.names.globals].find(([, name]) => name === "B")?.[0];
    assert.notEqual(globalId, undefined);
    const defined = result.module.globals[globalId! - result.module.globalImports.length]!;
    assert.equal(defined.mutable, true);
    assert.equal(defined.init.value, 0);
    assert.deepEqual(result.pendingInits, []);
    assert.deepEqual(
      meta.deferredGlobalInits.map(({ id, owner, kind }) => ({ id, owner, kind })),
      [{ id: "B:0", owner: "B", kind: "global" }],
    );
  });

  test("stamps unique owner-scoped initializer ids in extraction order", () => {
    const { meta } = checked(`
      struct Pair { left: i32, right: i32 }
      fn one(): i32 { return 1; }
      fn two(): i32 { return 2; }
      let pair: Pair = { right = two(), left = one() };
      let scalar: i32 = one() + two();
    `);
    assert.deepEqual(
      meta.deferredGlobalInits.map(({ id, owner, kind }) => ({ id, owner, kind })),
      [
        { id: "pair:0", owner: "pair", kind: "memory" },
        { id: "pair:1", owner: "pair", kind: "memory" },
        { id: "scalar:0", owner: "scalar", kind: "global" },
      ],
    );
    assert.equal(new Set(meta.deferredGlobalInits.map((entry) => entry.id)).size, 3);
  });
});

describe("IR scalar lowering: intrinsics", () => {
  maybeTest("executes load/store, memory size/grow, and memory copy", () => {
    const source = `
      export fn memoryOps(): i32 {
        __store_i32(65536, 42);
        __memory_copy(65540, 65536, 4);
        return __load_i32(65540);
      }
      export fn pages(): i32 {
        let before: i32 = __memory_size();
        let previous: i32 = __memory_grow(1);
        return before * 100 + previous * 10 + __memory_size();
      }
    `;
    assert.equal(differential(source, "memoryOps"), 42);
    assert.equal(differential(source, "pages"), 223);
  });

  for (const intrinsic of [
    { name: "__sqrt_f32", type: "f32", args: "16.0", expected: 4 },
    { name: "__abs_f32", type: "f32", args: "-3.0", expected: 3 },
    { name: "__floor_f32", type: "f32", args: "1.9", expected: 1 },
    { name: "__ceil_f32", type: "f32", args: "1.1", expected: 2 },
    { name: "__nearest_f32", type: "f32", args: "2.5", expected: 2 },
    { name: "__trunc_f32", type: "f32", args: "-1.9", expected: -1 },
    { name: "__copysign_f32", type: "f32", args: "3.0, -1.0", expected: -3 },
    { name: "__sqrt_f64", type: "f64", args: "16.0 as f64", expected: 4 },
    { name: "__abs_f64", type: "f64", args: "-3.0 as f64", expected: 3 },
    { name: "__floor_f64", type: "f64", args: "1.9 as f64", expected: 1 },
    { name: "__ceil_f64", type: "f64", args: "1.1 as f64", expected: 2 },
    { name: "__nearest_f64", type: "f64", args: "2.5 as f64", expected: 2 },
    { name: "__trunc_f64", type: "f64", args: "-1.9 as f64", expected: -1 },
    {
      name: "__copysign_f64",
      type: "f64",
      args: "3.0 as f64, -1.0 as f64",
      expected: -3,
    },
  ] as const) {
    maybeTest(`${intrinsic.name} lowers to its opcode`, () => {
      const source = `export fn run(): ${intrinsic.type} { return ${intrinsic.name}(${intrinsic.args}); }`;
      assert.equal(differential(source, "run"), intrinsic.expected);
    });
  }
});

describe("IR scalar lowering: defensive diagnostics", () => {
  test("requires checker annotations", () => {
    const { ast, meta } = checked("export fn run(value: i32): i32 { return value; }");
    const fn = ast.statements.find((statement) => statement instanceof FunctionStatement);
    assert(fn instanceof FunctionStatement);
    const returned = fn.fnExpr.body.statements[0];
    assert(returned instanceof ReturnStatement);
    const identifier = returned.returnValues[0];
    assert(identifier instanceof Identifier);
    delete (identifier as ASTExpression).resolvedType;
    assert.throws(() => lowerModule(ast, meta), /lowering: missing annotation on Identifier/);
  });

  test("hands memory constructs to the T31 lowering slice", () => {
    const { ast, meta } = checked(`
      struct Pair { value: i32 }
      export fn run(): i32 { let pair: Pair = { value = 1 }; return 0; }
    `);
    const fn = ast.statements.find((statement) => statement instanceof FunctionStatement);
    assert(fn instanceof FunctionStatement);
    const local = fn.fnExpr.body.statements[0];
    assert(local && "expression" in local);
    assert(local.expression instanceof StructLiteralExpression);
    const result = lowerModule(ast, meta);
    assert.deepEqual(validateModule(result.module), []);
    assert(result.module.structLayouts.has("Pair"));
  });
});
