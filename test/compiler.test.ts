import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  compiler,
  linkStdlibImports,
  printValidatedModule,
  resolveImportModule,
} from "../src/compiler/compiler";
import type { ExportMeta } from "../src/compiler/emitters/emitter.types";
import { emitExpression } from "../src/compiler/emitters/expression/expression";
import { resolveStructMember } from "../src/compiler/emitters/expression/member";
import {
  collectFnReferences,
  emitModule,
  extractModuleMeta,
} from "../src/compiler/emitters/module";
import { MapleError } from "../src/compiler/errors";
import { ModuleEmitter } from "../src/compiler/ModuleEmitter";
import { typeCheck } from "../src/compiler/TypeChecker";
import { lowerModule } from "../src/ir/lower";
import type { Token } from "../src/lexer/token.types";
import { InfixExpression } from "../src/parser/ast/expressions/InfixExpression";
import { IntegerLiteralExpression } from "../src/parser/ast/expressions/IntegerLiteral";
import { MemberExpression } from "../src/parser/ast/expressions/MemberExpression";
import { StructLiteralExpression } from "../src/parser/ast/expressions/StructLiteralExpression";
import type { ASTExpression } from "../src/parser/ast/types/ast.type";
import { Parser } from "../src/parser/Parser";
import { maybeTest, runExport, runMergedExport } from "./helpers";

function compileWithIr(src: string, moduleName: string, fileName?: string) {
  const parser = new Parser(src, fileName);
  const ast = parser.parse(moduleName);
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
  const result = lowerModule(ast, meta);
  assert.deepEqual(result.pendingInits, []);
  const wat = printValidatedModule(result.module, []);
  return { ast, meta, mod: result.module, wat };
}

function compile(src: string) {
  return compileWithIr(src, "test");
}

function checkedCompile(src: string) {
  return compileWithIr(src, "behavioralization", "behavioralization.maple");
}

function checkerMessages(src: string): string[] {
  const parser = new Parser(src, "behavioralization.maple");
  const ast = parser.parse("behavioralization");
  assert.deepEqual(
    parser.errors.map((error) => error.message),
    [],
  );
  const meta = extractModuleMeta(ast, true);
  collectFnReferences(ast, meta);
  linkStdlibImports(meta);
  return typeCheck(ast, meta).map((error) => error.message);
}

describe("Emission: Functions", () => {
  maybeTest("void functions execute their side effects without producing a value", () => {
    const { wat } = checkedCompile(`
      let touched: i32 = 0;
      fn mark(): void { touched = 7; }
      export fn run(): i32 { mark(); return touched; }
    `);
    assert.equal(runExport(wat, "run"), 7);
  });

  maybeTest("i32 functions return their value", () => {
    const { wat } = checkedCompile("export fn run(): i32 { return 1; }");
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("f32 functions return their value", () => {
    const { wat } = checkedCompile("export fn run(): f32 { return 1.5; }");
    assert.equal(runExport(wat, "run"), 1.5);
  });

  maybeTest("i32 parameters participate in function behavior", () => {
    const { wat } = checkedCompile("export fn add(a: i32, b: i32): i32 { return a + b; }");
    assert.equal(runExport(wat, "add", [3, 4]), 7);
  });

  maybeTest("mixed parameter types preserve both arguments", () => {
    const { wat } = checkedCompile(`
      export fn mixed(a: i32, b: f32): i32 { return a + (b as i32); }
    `);
    assert.equal(runExport(wat, "mixed", [3, 4.75]), 7);
  });

  maybeTest("zero-argument function calls return the callee value", () => {
    const { wat } = checkedCompile(`
      fn callee(): i32 { return 1; }
      export fn caller(): i32 { return callee(); }
    `);
    assert.equal(runExport(wat, "caller"), 1);
  });

  maybeTest("function calls pass arguments in source order", () => {
    const { wat } = checkedCompile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      export fn caller(): i32 { return add(3, 4); }
    `);
    assert.equal(runExport(wat, "caller"), 7);
  });

  maybeTest("four parameters are passed exactly once", () => {
    const { wat } = checkedCompile(`
      export fn quad(a: i32, b: i32, c: f32, d: i32): i32 {
        return a + b + (c as i32) + d;
      }
    `);
    assert.equal(runExport(wat, "quad", [1, 2, 3.75, 4]), 10);
  });
});

describe("Emission: Variables", () => {
  maybeTest("local i32 bindings preserve their value", () => {
    const { wat } = checkedCompile("export fn run(): i32 { let x: i32 = 5; return x; }");
    assert.equal(runExport(wat, "run"), 5);
  });

  maybeTest("local f32 bindings preserve their value", () => {
    const { wat } = checkedCompile("export fn run(): f32 { let x: f32 = 3.25; return x; }");
    assert.equal(runExport(wat, "run"), 3.25);
  });

  maybeTest("local bool bindings preserve canonical truth", () => {
    const { wat } = checkedCompile("export fn run(): bool { let x: bool = true; return x; }");
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("global f32 bindings preserve their value", () => {
    const { wat } = checkedCompile(`
      let rate: f32 = 1.5;
      export fn run(): f32 { return rate; }
    `);
    assert.equal(runExport(wat, "run"), 1.5);
  });

  maybeTest("global i32 bindings preserve their value", () => {
    const { wat } = checkedCompile(`
      let x: i32 = 5;
      export fn run(): i32 { return x; }
    `);
    assert.equal(runExport(wat, "run"), 5);
  });

  maybeTest("i32 assignment updates the local value", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 { let x: i32 = 0; x = 10; return x; }
    `);
    assert.equal(runExport(wat, "run"), 10);
  });

  maybeTest("f32 assignment updates the local value", () => {
    const { wat } = checkedCompile(`
      export fn run(): f32 { let x: f32 = 0.0; x = 2.5; return x; }
    `);
    assert.equal(runExport(wat, "run"), 2.5);
  });
});

describe("Emission: Structs", () => {
  test("struct metadata includes members and size", () => {
    const { meta } = compile("struct S { a: i32, b: f32 }");
    assert(meta.structs.S !== undefined);
    assert(meta.structs.S.members.a !== undefined);
    assert(meta.structs.S.members.b !== undefined);
    assert.equal(meta.structs.S.size, 8);
  });

  maybeTest("mixed i32 and f32 members round-trip independently", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: f32 }
      export fn run(): i32 {
        let p: Point = { x = 10, y = 3.14 };
        return p.x + (p.y as i32);
      }
    `);
    assert.equal(runExport(wat, "run"), 13);
  });

  maybeTest("f32-only struct members round-trip", () => {
    const { wat } = checkedCompile(`
      struct Vec2 { x: f32, y: f32 }
      export fn run(): f32 {
        let v: Vec2 = { x = 1.5, y = 2.5 };
        return v.x + v.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 4);
  });

  maybeTest("struct i32 members participate in binary arithmetic", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 3, y = 4 };
        return p.x + p.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 7);
  });

  maybeTest("struct members participate in comparisons", () => {
    const { wat } = checkedCompile(`
      struct Counter { n: i32 }
      export fn run(): i32 {
        let c: Counter = { n = 5 };
        if (c.n > 0) {
          return 1;
        }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("struct f32 members participate in binary arithmetic", () => {
    const { wat } = checkedCompile(`
      struct Vec2 { x: f32, y: f32 }
      export fn run(): f32 {
        let v: Vec2 = { x = 1.5, y = 2.5 };
        return v.x + v.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 4);
  });

  maybeTest("struct members drive while-loop conditions", () => {
    const { wat } = checkedCompile(`
      struct Flag { active: i32 }
      export fn run(): i32 {
        let f: Flag = { active = 1 };
        let count: i32 = 0;
        while (f.active) {
          count++;
          f.active = 0;
        }
        return count * 10 + f.active;
      }
    `);
    assert.equal(runExport(wat, "run"), 10);
  });

  maybeTest("prefix minus negates a struct member", () => {
    const { wat } = checkedCompile(`
      struct Num { val: i32 }
      export fn run(): i32 {
        let n: Num = { val = 7 };
        return -n.val;
      }
    `);
    assert.equal(runExport(wat, "run"), -7);
  });

  maybeTest("memory-backed struct parameters preserve member values", () => {
    const { wat } = checkedCompile(`
      struct Pair { a: i32, b: i32 }
      fn sum(p: Pair): i32 { return p.a + p.b; }
      export fn run(): i32 {
        let p: Pair = { a = 3, b = 4 };
        return sum(p);
      }
    `);
    assert.equal(runExport(wat, "run"), 7);
  });
});

describe("Emission: Control Flow", () => {
  maybeTest("if without else selects the matching path", () => {
    const { wat } = checkedCompile(
      "export fn run(x: i32): i32 { if (x > 0) { return 1; } return 0; }",
    );
    assert.equal(runExport(wat, "run", [1]), 1);
    assert.equal(runExport(wat, "run", [0]), 0);
  });

  maybeTest("if with else selects both branches", () => {
    const { wat } = checkedCompile(
      "export fn run(x: i32): i32 { if (x > 0) { return 1; } else { return 2; } }",
    );
    assert.equal(runExport(wat, "run", [1]), 1);
    assert.equal(runExport(wat, "run", [0]), 2);
  });

  maybeTest("for loop executes its body and update", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let count: i32 = 0;
        for (let i: i32 = 0; i < 3; i = i + 1) { count++; }
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 3);
  });

  maybeTest("while loop rechecks its condition", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let i: i32 = 0;
        while (i < 3) { i = i + 1; }
        return i;
      }
    `);
    assert.equal(runExport(wat, "run"), 3);
  });

  maybeTest("break exits its loop", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let count: i32 = 0;
        while (true) { count++; break; }
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });
});

describe("Emission: Arithmetic", () => {
  maybeTest("i32 addition returns the sum", () => {
    const { wat } = checkedCompile("export fn run(): i32 { return 1 + 2; }");
    assert.equal(runExport(wat, "run"), 3);
  });

  maybeTest("f32 addition returns the sum", () => {
    const { wat } = checkedCompile("export fn run(): f32 { return 1.0 + 2.0; }");
    assert.equal(runExport(wat, "run"), 3);
  });

  maybeTest("i32 subtraction, multiplication, and division compose", () => {
    const { wat } = checkedCompile(
      "export fn run(a: i32, b: i32): i32 { return (a - b) * (a / b); }",
    );
    assert.equal(runExport(wat, "run", [9, 3]), 18);
  });

  maybeTest("f32 subtraction, multiplication, and division compose", () => {
    const { wat } = checkedCompile(
      "export fn run(a: f32, b: f32): f32 { return (a - b) * (a / b); }",
    );
    assert.equal(runExport(wat, "run", [9, 3]), 18);
  });

  maybeTest("i32 remainder preserves the dividend sign", () => {
    const { wat } = checkedCompile("export fn run(a: i32, b: i32): i32 { return a % b; }");
    assert.equal(runExport(wat, "run", [-7, 3]), -1);
  });
});

describe("Emission: Comparisons", () => {
  maybeTest("i32 greater-than and less-than are signed", () => {
    const { wat } = checkedCompile(`
      export fn gt(a: i32, b: i32): i32 { return a > b; }
      export fn lt(a: i32, b: i32): i32 { return a < b; }
    `);
    assert.equal(runExport(wat, "gt", [-1, 1]), 0);
    assert.equal(runExport(wat, "lt", [-1, 1]), 1);
  });

  maybeTest("f32 greater-than and less-than compare values", () => {
    const { wat } = checkedCompile(`
      export fn gt(a: f32, b: f32): i32 { return a > b; }
      export fn lt(a: f32, b: f32): i32 { return a < b; }
    `);
    assert.equal(runExport(wat, "gt", [2.5, 1.5]), 1);
    assert.equal(runExport(wat, "lt", [2.5, 1.5]), 0);
  });

  maybeTest("i32 inclusive comparisons include equality", () => {
    const { wat } = checkedCompile(`
      export fn gte(a: i32, b: i32): i32 { return a >= b; }
      export fn lte(a: i32, b: i32): i32 { return a <= b; }
    `);
    assert.equal(runExport(wat, "gte", [2, 2]), 1);
    assert.equal(runExport(wat, "lte", [2, 2]), 1);
  });

  maybeTest("f32 inclusive comparisons include equality", () => {
    const { wat } = checkedCompile(`
      export fn gte(a: f32, b: f32): i32 { return a >= b; }
      export fn lte(a: f32, b: f32): i32 { return a <= b; }
    `);
    assert.equal(runExport(wat, "gte", [2.5, 2.5]), 1);
    assert.equal(runExport(wat, "lte", [2.5, 2.5]), 1);
  });

  maybeTest("integer and float equality and inequality are observable", () => {
    const { wat } = checkedCompile(`
      export fn eqi(a: i32, b: i32): i32 { return a == b; }
      export fn nei(a: i32, b: i32): i32 { return a != b; }
      export fn eqf(a: f32, b: f32): i32 { return a == b; }
      export fn nef(a: f32, b: f32): i32 { return a != b; }
    `);
    assert.equal(runExport(wat, "eqi", [3, 3]), 1);
    assert.equal(runExport(wat, "nei", [3, 4]), 1);
    assert.equal(runExport(wat, "eqf", [1.5, 1.5]), 1);
    assert.equal(runExport(wat, "nef", [1.5, 2.5]), 1);
  });
});

describe("Emission: Bitwise / Logical / Shift Ops", () => {
  maybeTest("&& and || short-circuit their right operands", () => {
    const { wat } = checkedCompile(`
      let calls: i32 = 0;
      fn tick(value: i32): i32 { calls++; return value; }
      export fn and_false(): i32 {
        let result: i32 = 0 && tick(1);
        return calls * 10 + result;
      }
      export fn or_true(): i32 {
        let result: i32 = 1 || tick(0);
        return calls * 10 + result;
      }
    `);
    assert.equal(runExport(wat, "and_false"), 0);
    assert.equal(runExport(wat, "or_true"), 1);
  });

  maybeTest("bitwise and, or, and xor compose", () => {
    const { wat } = checkedCompile(
      "export fn run(a: i32, b: i32): i32 { return (a & b) | (a ^ b); }",
    );
    assert.equal(runExport(wat, "run", [12, 10]), 14);
  });

  maybeTest("left and signed-right shifts compose", () => {
    const { wat } = checkedCompile("export fn run(a: i32): i32 { return (a << 1) >> 1; }");
    assert.equal(runExport(wat, "run", [-8]), -8);
  });
});

describe("Emission: Prefix/Postfix", () => {
  maybeTest("logical not flips integer truthiness", () => {
    const { wat } = checkedCompile("export fn run(x: i32): i32 { return !x; }");
    assert.equal(runExport(wat, "run", [0]), 1);
    assert.equal(runExport(wat, "run", [3]), 0);
  });

  maybeTest("prefix minus negates integers", () => {
    const { wat } = checkedCompile("export fn run(x: i32): i32 { return -x; }");
    assert.equal(runExport(wat, "run", [7]), -7);
  });

  maybeTest("prefix minus negates floats", () => {
    const { wat } = checkedCompile("export fn run(x: f32): f32 { return -x; }");
    assert.equal(runExport(wat, "run", [2.5]), -2.5);
  });

  maybeTest("bitwise not flips every bit", () => {
    const { wat } = checkedCompile("export fn run(x: i32): i32 { return ~x; }");
    assert.equal(runExport(wat, "run", [5]), -6);
  });

  maybeTest("postfix increment and decrement update their local", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let x: i32 = 3;
        x++;
        x--;
        return x;
      }
    `);
    assert.equal(runExport(wat, "run"), 3);
  });
});

describe("Emission: Cast", () => {
  maybeTest("i32 as f32 preserves signed values", () => {
    const { wat } = checkedCompile("export fn run(x: i32): f32 { return x as f32; }");
    assert.equal(runExport(wat, "run", [-7]), -7);
  });

  maybeTest("f32 as i32 truncates toward zero", () => {
    const { wat } = checkedCompile("export fn run(x: f32): i32 { return x as i32; }");
    assert.equal(runExport(wat, "run", [3.9]), 3);
  });

  maybeTest("i32 as u8 truncates to the low byte", () => {
    const { wat } = checkedCompile("export fn run(n: i32): i32 { return n as u8; }");
    assert.equal(runExport(wat, "run", [300]), 44);
  });

  maybeTest("cast inside a binary expression adopts the float type", () => {
    const { wat } = checkedCompile("export fn run(x: i32): f32 { return x as f32 + 1.0; }");
    assert.equal(runExport(wat, "run", [3]), 4);
  });
});

describe("Emission: 64-bit widths and unsigned ops", () => {
  maybeTest("i64 addition preserves values above the i32 range", () => {
    const { wat, meta } = checkedCompile(`export fn add64(a: i64, b: i64): i64 { return a + b; }`);
    assert.equal(runExport(wat, "add64", [4_000_000_000n, 5n]), 4_000_000_005n);
    assert.equal(meta.functions.add64?.signature, "II_I");
  });

  maybeTest("u32 division treats the lane as unsigned", () => {
    const { wat } = checkedCompile(`export fn udiv(a: u32, b: u32): u32 { return a / b; }`);
    assert.equal(runExport(wat, "udiv", [-1, 2]), 2_147_483_647);
  });

  maybeTest("i32 division treats the lane as signed", () => {
    const { wat } = checkedCompile(`export fn sdiv(a: i32, b: i32): i32 { return a / b; }`);
    assert.equal(runExport(wat, "sdiv", [-9, 2]), -4);
  });

  maybeTest("u64 division treats the lane as unsigned", () => {
    const { wat } = checkedCompile(`export fn udiv(a: u64, b: u64): u64 { return a / b; }`);
    assert.equal(runExport(wat, "udiv", [-1n, 2n]), 9_223_372_036_854_775_807n);
  });

  maybeTest("u64 right shift fills with zeros", () => {
    const { wat } = checkedCompile(`export fn shr(a: u64, b: u64): u64 { return a >> b; }`);
    assert.equal(runExport(wat, "shr", [-1n, 1n]), 9_223_372_036_854_775_807n);
  });

  maybeTest("i64 right shift preserves the sign", () => {
    const { wat } = checkedCompile(`export fn shr(a: i64, b: i64): i64 { return a >> b; }`);
    assert.equal(runExport(wat, "shr", [-8n, 1n]), -4n);
  });

  maybeTest("f64 remainder follows truncated division", () => {
    const { wat } = checkedCompile(`export fn rem(a: f64, b: f64): f64 { return a % b; }`);
    assert.equal(runExport(wat, "rem", [-7.5, 2]), -1.5);
  });

  maybeTest("struct members preserve i64 values", () => {
    const { wat } = checkedCompile(`
      struct S { x: i32, y: i64, }
      export fn loady(): i64 {
        let s: S = { x = 1, y = 2 as i64, };
        return s.y;
      }
    `);
    assert.equal(runExport(wat, "loady"), 2n);
  });
});

describe("legacy emitter unit (dies with T38)", () => {
  function legacyCompile(src: string) {
    const parser = new Parser(src);
    const ast = parser.parse("test");
    assert.equal(
      parser.errors.length,
      0,
      `Parse errors: ${parser.errors.map((error) => error.message).join(", ")}`,
    );
    const meta = extractModuleMeta(ast);
    collectFnReferences(ast, meta);
    linkStdlibImports(meta);
    const mod = emitModule(ast, meta);
    return { ast, meta, mod, wat: mod.buildWat() };
  }

  test("resolved import with I_I emits i64 param and result in type", () => {
    const p = new Parser(`
      import callee from "m"
      fn f(x: i64): i64 { return callee(x); }
    `);
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0);
    const meta = extractModuleMeta(ast);
    const callee = meta.imports.callee;
    assert(callee);
    callee.resolved = true;
    callee.info = {
      kind: "func",
      signature: "I_I",
    } as ExportMeta;
    const wat = emitModule(ast, meta).buildWat();
    assert(wat.includes("$I_I_type"), wat);
    assert(wat.includes("(param i64)"), wat);
    assert(wat.includes("(result i64)"), wat);
  });

  test("emitModule can request an imported memory", () => {
    const p = new Parser("fn test(): void {}");
    const ast = p.parse("test");
    const meta = extractModuleMeta(ast);
    const wat = emitModule(ast, meta, { importMemory: true }).buildWat();
    assert(wat.includes('(import "runtime" "memory" (memory 2))'));
    assert(!wat.includes('(memory (export "memory")'));
  });

  test("import emission includes import and type when import is resolved as function", () => {
    const p = new Parser('import foo from "mod"');
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0);
    const meta = extractModuleMeta(ast);
    const foo = meta.imports.foo;
    assert(foo);
    foo.resolved = true;
    foo.info = {
      kind: "func",
      signature: "i_i",
    } as ExportMeta;
    const wat = emitModule(ast, meta).buildWat();
    assert(wat.includes('(import "mod" "foo" (func $foo (type $i_i_type)))'));
    assert(wat.includes("(type $i_i_type (func (param i32) (result i32)))"));
  });

  test("member access on an unsupported base shape errors", () => {
    const token = {
      type: "Identifier" as const,
      literal: "x",
      col: 0,
      line: 0,
      end: 0,
      start: 0,
    };
    const nonSupported = new InfixExpression(
      token,
      "dummy" as unknown as ASTExpression,
      "+",
      "dummy" as unknown as ASTExpression,
    );
    const memberExpr = new MemberExpression(
      token,
      nonSupported as unknown as ASTExpression,
      "field",
    );
    const meta = extractModuleMeta(new Parser("").parse("test"));
    const emitter = new ModuleEmitter(meta);

    assert.throws(() => resolveStructMember(memberExpr, emitter), {
      message: /unsupported base/,
    });
  });

  test("expression elements throw instead of silently encoding zero", () => {
    assert.throws(
      () => legacyCompile("fn f(): void { let x: i32 = 1; let a: i32[] = [x]; }"),
      /array literal element must be a literal/,
    );
  });

  test("void function with local struct and value return does not reference $__ret_tmp", () => {
    // Emitter robustness path: type checker would reject this program, but
    // emitter-only compile should not emit undeclared $__ret_tmp references.
    const { wat } = legacyCompile(`
      struct Point { x: i32, y: i32 }
      fn test(): void {
        let p: Point = { x = 1, y = 2 };
        return 5;
      }
    `);
    assert(!wat.includes("local.set $__ret_tmp"), `Must not set $__ret_tmp in void fn:\n${wat}`);
    assert(!wat.includes("local.get $__ret_tmp"), `Must not get $__ret_tmp in void fn:\n${wat}`);
    assert(wat.includes("(return (i32.const 5))"), `Missing direct value return:\n${wat}`);
    assert(
      wat.includes("(global.set $__sp (i32.add"),
      `Missing SP restore before value return in void fn:\n${wat}`,
    );
  });

  test("emitExpression throws clear MapleError for struct literal value-position use", () => {
    const token: Token = { type: "LBrace", literal: "{", start: 0, end: 1, line: 1, col: 1 };
    const fieldToken: Token = {
      type: "IntegerLiteral",
      literal: 1,
      start: 7,
      end: 8,
      line: 1,
      col: 8,
    };
    const expr = new StructLiteralExpression(token, "Point", {
      x: new IntegerLiteralExpression(fieldToken, 1),
    });
    const emitter = new ModuleEmitter({
      name: "test",
      globals: {},
      functions: {},
      imports: {},
      exports: {},
      structs: {
        Point: {
          name: "Point",
          size: 4,
          members: {
            x: { name: "x", type: "i32", size: 4, offset: 0 },
          },
        },
      },
      data: [],
      stringPool: {},
      dataPtr: 65536,
      deferredGlobalInits: [],
      fnTable: new Map(),
      fnSignatures: new Map(),
      liftedLambdas: [],
      hasFnTypedSurface: false,
      needsFnrefCreation: false,
    });
    assert.throws(
      () => emitExpression(expr, emitter),
      (err: unknown) => {
        assert(err instanceof MapleError);
        assert(
          err.message.includes("must be assigned to a 'let' binding"),
          `Unexpected message: ${String((err as Error).message)}`,
        );
        return true;
      },
    );
  });
});

describe("Emission: Postfix Statement", () => {
  maybeTest("idx++ as a statement increments the local", () => {
    const { wat } = checkedCompile("export fn run(): i32 { let idx: i32 = 0; idx++; return idx; }");
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("idx-- as a statement decrements the local", () => {
    const { wat } = checkedCompile("export fn run(): i32 { let idx: i32 = 5; idx--; return idx; }");
    assert.equal(runExport(wat, "run"), 4);
  });

  maybeTest("postfix as an rvalue returns the old value and still mutates", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let idx: i32 = 3;
        let old: i32 = idx++;
        return old * 10 + idx;
      }
    `);
    assert.equal(runExport(wat, "run"), 34);
  });
});

describe("Emission: Compound Assignments", () => {
  maybeTest("compound assignments preserve every operator's behavior", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let x: i32 = 10;
        x += 2;
        x -= 1;
        x *= 3;
        x /= 2;
        x %= 5;
        x |= 4;
        x &= 7;
        x ^= 1;
        x <<= 2;
        x >>= 1;
        return x;
      }
    `);
    assert.equal(runExport(wat, "run"), 8);
  });
});

describe("Emission: Member Access", () => {
  maybeTest("member access reads from an identifier parent", () => {
    const { wat } = checkedCompile(`
      struct S { a: i32, b: i32 }
      let s: S = { a = 1, b = 2 };
      export fn run(): i32 { return s.a; }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("member access reads from a function-call base", () => {
    const { wat } = checkedCompile(`
      struct P { x: i32 }
      fn make(): P { let p: P = { x = 42 }; return p; }
      export fn run(): i32 { return make().x; }
    `);
    assert.equal(runExport(wat, "run"), 42);
  });

  maybeTest("member assignment updates a local struct field", () => {
    const { wat } = checkedCompile(`
      struct Thing { a: i32 }
      export fn run(): i32 {
        let t: Thing = { a = 1 };
        t.a = 14;
        return t.a;
      }
    `);
    assert.equal(runExport(wat, "run"), 14);
  });
});

describe("Emission: Index Access", () => {
  maybeTest("literal array indexes read the selected element", () => {
    const { wat } = checkedCompile(
      "export fn run(): i32 { let arr: i32[] = [1, 2, 3]; return arr[0]; }",
    );
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("variable array indexes read the selected element", () => {
    const { wat } = checkedCompile(
      "export fn run(): i32 { let arr: i32[] = [1, 2, 3]; let x: i32 = 1; return arr[x]; }",
    );
    assert.equal(runExport(wat, "run"), 2);
  });

  maybeTest("expression array indexes read the selected element", () => {
    const { wat } = checkedCompile(
      "export fn run(): i32 { let arr: i32[] = [1, 2, 3]; let x: i32 = 1; return arr[x + 1]; }",
    );
    assert.equal(runExport(wat, "run"), 3);
  });
});

describe("Emission: Literals", () => {
  maybeTest("integer literals return their exact value", () => {
    const { wat } = checkedCompile("export fn run(): i32 { return 42; }");
    assert.equal(runExport(wat, "run"), 42);
  });

  maybeTest("negative integer literals retain their sign", () => {
    const { wat } = checkedCompile("export fn run(): i32 { return -5; }");
    assert.equal(runExport(wat, "run"), -5);
  });

  maybeTest("folded negative zero retains its IEEE-754 sign", () => {
    const { wat } = checkedCompile("export fn run(): f32 { return -0.0; }");
    assert(Object.is(runExport(wat, "run"), -0));
  });

  maybeTest("float literals return their f32 value", () => {
    const { wat } = checkedCompile("export fn run(): f32 { return 3.14; }");
    assert(Math.abs((runExport(wat, "run") as number) - 3.14) < 0.000_001);
  });

  maybeTest("boolean literals return canonical truth values", () => {
    const { wat } = checkedCompile(
      "export fn yes(): i32 { return true; } export fn no(): i32 { return false; }",
    );
    assert.equal(runExport(wat, "yes"), 1);
    assert.equal(runExport(wat, "no"), 0);
  });

  maybeTest("string literals materialize their payload and metadata", () => {
    const { wat } = checkedCompile(
      'export fn run(): i32 { let s: string = "hello"; return s.len; }',
    );
    assert.equal(runExport(wat, "run"), 5);
  });

  test("string payload data has no trailing allocation padding", () => {
    const { meta } = compile(`let text: string = "abc";`);
    const payload = meta.data.find((entry) => entry.bytes.startsWith("\\61\\62\\63"));

    assert(payload, "missing string payload segment");
    assert.equal(payload.bytes, "\\61\\62\\63");
  });

  test("char literal currently fails to parse as expression", () => {
    const p = new Parser("fn test(): i32 { return 'a'; }");
    p.parse("test");
    assert(p.errors.length > 0);
    assert(
      p.errors.some((e) => e.message.includes("No prefix parse function found for CharLiteral")),
    );
  });
});

describe("Module Metadata", () => {
  test("single import populates metadata", () => {
    const { meta } = compile('import foo from "mod"');
    assert(meta.imports.foo !== undefined);
    assert.equal(meta.imports.foo.module, "mod");
  });

  test("multi import populates metadata entries", () => {
    const { meta } = compile('import a, b from "mod"');
    assert(meta.imports.a !== undefined);
    assert(meta.imports.b !== undefined);
  });

  test("exported function appears in exports metadata", () => {
    const { meta } = compile("export fn test(): void {}");
    assert(meta.exports.test !== undefined);
    assert.equal(meta.exports.test.kind, "func");
  });

  test("exported global appears in exports metadata", () => {
    const { meta } = compile("export let x: i32 = 0;");
    assert(meta.exports.x !== undefined);
    assert.equal(meta.exports.x.kind, "global");
  });

  test("exported struct appears in exports", () => {
    const { meta } = compile("export struct Visible { x: i32 }");
    assert(meta.exports.Visible !== undefined);
    assert.equal(meta.exports.Visible.kind, "struct");
  });

  test("non-exported struct does not appear in exports", () => {
    const { meta } = compile("struct Hidden { x: i32 }");
    assert.equal(meta.exports.Hidden, undefined);
  });

  test("mixed exported and non-exported structs keep struct metadata but only export public", () => {
    const { meta } = compile("export struct Pub { x: i32 } struct Priv { y: f32 }");
    assert(meta.exports.Pub !== undefined);
    assert.equal(meta.exports.Priv, undefined);
    assert(meta.structs.Pub !== undefined);
    assert(meta.structs.Priv !== undefined);
  });
});

describe("Emission: else if", () => {
  maybeTest("else-if chain selects every branch", () => {
    const { wat } = checkedCompile(`
      export fn grade(score: i32): i32 {
        if (score >= 90) {
          return 5;
        } else if (score >= 75) {
          return 4;
        } else {
          return 3;
        }
      }
    `);
    assert.equal(runExport(wat, "grade", [95]), 5);
    assert.equal(runExport(wat, "grade", [80]), 4);
    assert.equal(runExport(wat, "grade", [50]), 3);
  });

  maybeTest("three-level else-if chain selects every branch", () => {
    const { wat } = checkedCompile(`
      export fn classify(n: i32): i32 {
        if (n == 0) {
          return 10;
        } else if (n == 1) {
          return 20;
        } else if (n == 2) {
          return 30;
        } else {
          return 40;
        }
      }
    `);
    assert.equal(runExport(wat, "classify", [0]), 10);
    assert.equal(runExport(wat, "classify", [1]), 20);
    assert.equal(runExport(wat, "classify", [2]), 30);
    assert.equal(runExport(wat, "classify", [3]), 40);
  });
});

describe("Emission: continue", () => {
  maybeTest("continue in a for loop still runs the update", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let touched: i32 = 0;
        for (let i: i32 = 0; i < 10; i = i + 1) {
          continue;
          touched++;
        }
        return touched;
      }
    `);
    assert.equal(runExport(wat, "run"), 0);
  });

  maybeTest("continue in a while loop rechecks the condition", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let i: i32 = 0;
        while (i < 5) {
          i = i + 1;
          continue;
        }
        return i;
      }
    `);
    assert.equal(runExport(wat, "run"), 5);
  });
});

describe("Emission: const", () => {
  maybeTest("const globals retain their initialized value", () => {
    const { wat } = checkedCompile(`const MAX: i32 = 100; export fn run(): i32 { return MAX; }`);
    assert.equal(runExport(wat, "run"), 100);
  });

  maybeTest("let globals remain mutable", () => {
    const { wat } = checkedCompile(`
      let x: i32 = 0;
      export fn run(): i32 { x++; x++; return x; }
    `);
    assert.equal(runExport(wat, "run"), 2);
  });
});

describe("Emission: array index write", () => {
  maybeTest("literal array indexes update only the selected element", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let arr: i32[] = [1, 2, 3];
        arr[0] = 99;
        return arr[0] * 10 + arr[1];
      }
    `);
    assert.equal(runExport(wat, "run"), 992);
  });

  maybeTest("variable array indexes update only the selected element", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let arr: i32[] = [1, 2, 3];
        let i: i32 = 1;
        arr[i] = 42;
        return arr[0] * 100 + arr[1] * 10 + arr[2];
      }
    `);
    assert.equal(runExport(wat, "run"), 523);
  });
});

describe("Emission: switch", () => {
  maybeTest("switch dispatches to each case and the default", () => {
    const { wat } = checkedCompile(`
      export fn classify(x: i32): i32 {
        switch (x) {
          case 0: { return 10; }
          case 1: { return 20; }
          default: { return 99; }
        }
        return -1;
      }
    `);
    assert.equal(runExport(wat, "classify", [0]), 10);
    assert.equal(runExport(wat, "classify", [1]), 20);
    assert.equal(runExport(wat, "classify", [9]), 99);
  });

  maybeTest("switch without a default continues after unmatched input", () => {
    const { wat } = checkedCompile(`
      export fn run(x: i32): i32 {
        switch (x) {
          case 0: { return 10; }
          case 1: { return 20; }
        }
        return 99;
      }
    `);
    assert.equal(runExport(wat, "run", [0]), 10);
    assert.equal(runExport(wat, "run", [1]), 20);
    assert.equal(runExport(wat, "run", [9]), 99);
  });
});

describe("Deterministic Compilation", () => {
  test("same source compiles to identical WAT on repeated calls", () => {
    const src = `fn loop_test(): void { for (let i: i32 = 0; i < 3; i = i + 1) { } }`;
    const { wat: wat1 } = compile(src);
    const { wat: wat2 } = compile(src);
    assert.equal(wat1, wat2, "label counter must reset between compilations");
  });

  test("two different compilations each start labels at index 0", () => {
    const src = `fn w(): void { while (1) { break; } }`;
    const { wat: wat1 } = compile(src);
    const { wat: wat2 } = compile(src);
    // both must reference $break_0 / $loop_1 (or whatever the scheme is),
    // not $break_4 / $loop_5 on the second call
    assert.equal(wat1, wat2);
  });
});

describe("Compiler Pipeline", () => {
  test("compiler function accepts output path parameter", () => {
    assert.equal(typeof compiler, "function");
    assert(compiler.length >= 3);
  });

  test("compiler reports file errors for missing input", async () => {
    await assert.rejects(
      compiler("/nonexistent/path.maple", "path", "/nonexistent", "out.wasm"),
      (err: Error) => {
        assert(err.message.includes("ENOENT"));
        return true;
      },
    );
  });

  test("compiler reports top-level destructuring let parse error", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "maple-9b-"));
    const entryPath = path.join(dir, "main.maple");
    await writeFile(
      entryPath,
      `
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      let (x, y) = swap(1, 2);
      `,
    );

    const loggedErrors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      loggedErrors.push(args.map((v) => String(v)).join(" "));
    };

    try {
      const result = await compiler(entryPath, "main.maple", dir, path.join(dir, "out.wasm"));
      assert.equal(result, undefined);
      assert(
        loggedErrors.some((msg) => msg.includes("top-level destructuring let is not supported")),
        `Expected parse error log, got: ${loggedErrors.join(" | ")}`,
      );
    } finally {
      console.error = originalError;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Compiler: stdlib source resolution", () => {
  test("bare string resolves to bundled Maple source before a local file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "maple-stdlib-source-"));
    await writeFile(
      path.join(dir, "string"),
      "export fn string_copy(value: i32): i32 { return value; }",
    );

    try {
      const resolved = resolveImportModule("string", dir);
      assert.equal(resolved.kind, "maple");
      assert.equal(resolved.data.exports.string_copy?.kind, "func");
      assert.equal(resolved.data.exports.string_copy?.signature, "ii_v");
      assert.deepEqual(Object.keys(resolved.data.exports), ["string_copy"]);
      assert.equal(path.basename(resolved.path), "string.maple");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("bare math resolves through bundled Maple source", () => {
    const resolved = resolveImportModule("math", "/unused");
    assert.equal(resolved.kind, "maple");
    assert.equal(path.basename(resolved.path), "math.maple");
    assert.deepEqual(Object.keys(resolved.data.exports).sort(), [
      "E",
      "HALF_PI",
      "PI",
      "TWO_PI",
      "abs_f32",
      "abs_f64",
      "abs_i32",
      "atan2",
      "ceil",
      "ceil_f64",
      "copysign",
      "copysign_f64",
      "cos",
      "floor",
      "floor_f64",
      "fmod",
      "fraction",
      "i_to_f",
      "max_f32",
      "max_i32",
      "min_f32",
      "min_i32",
      "pow",
      "round",
      "round_f64",
      "sin",
      "sqrt",
      "sqrt_f64",
      "tan",
      "trunc",
      "trunc_f64",
    ]);
    assert.equal(resolved.data.exports.sqrt?.kind, "func");
    assert.equal(resolved.data.exports.sqrt?.signature, "f_f");
    assert.equal(resolved.data.exports.pow?.kind, "func");
    assert.equal(resolved.data.exports.pow?.signature, "fi_f");
    assert.equal(resolved.data.exports.PI?.kind, "global");
    assert.equal(resolved.data.exports.PI?.type, "f32");
    assert.equal(resolved.data.exports.fraction?.kind, "struct");
  });

  test("bare memory resolves through bundled Maple source", () => {
    const resolved = resolveImportModule("memory", "/unused");
    assert.equal(resolved.kind, "maple");
    assert.equal(path.basename(resolved.path), "memory.maple");
    assert.deepEqual(Object.keys(resolved.data.exports).sort(), [
      "free",
      "heap_init",
      "malloc",
      "realloc",
    ]);
    assert.equal(resolved.data.exports.heap_init?.kind, "func");
    assert.equal(resolved.data.exports.heap_init?.signature, "i_v");
    assert.equal(resolved.data.exports.malloc?.kind, "func");
    assert.equal(resolved.data.exports.malloc?.signature, "i_i");
    assert.equal(resolved.data.exports.free?.kind, "func");
    assert.equal(resolved.data.exports.free?.signature, "i_v");
    assert.equal(resolved.data.exports.realloc?.kind, "func");
    assert.equal(resolved.data.exports.realloc?.signature, "iii_i");
  });

  test("unknown bare imports keep the existing file error", () => {
    assert.throws(
      () => resolveImportModule("definitely-not-a-maple-module", "/nonexistent"),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
  });

  test("relative string paths resolve to the importer-local file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "maple-local-source-"));
    const localPath = path.join(dir, "string.maple");
    await writeFile(localPath, "export fn local_string(value: i32): i32 { return value; }");

    try {
      const resolved = resolveImportModule("./string.maple", dir);
      assert.equal(resolved.kind, "maple");
      assert.equal(resolved.path, localPath);
      assert.equal(resolved.data.exports.local_string?.kind, "func");
      assert.equal(resolved.data.exports.local_string?.signature, "i_i");
      assert.equal(resolved.data.exports.string_copy, undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Emission: Type inference", () => {
  maybeTest("inferred i32 locals preserve their value", () => {
    const { wat } = checkedCompile("export fn run(): i32 { let x = 5; return x; }");
    assert.equal(runExport(wat, "run"), 5);
  });

  maybeTest("inferred f32 locals preserve their value", () => {
    const { wat } = checkedCompile("export fn run(): f32 { let y = 3.14; return y; }");
    assert(Math.abs((runExport(wat, "run") as number) - 3.14) < 0.000_001);
  });
});

describe("Emission: Strings", () => {
  maybeTest("explicit string locals preserve their payload", () => {
    const { wat } = checkedCompile(
      'export fn run(): i32 { let s: string = "hello"; return s.len; }',
    );
    assert.equal(runExport(wat, "run"), 5);
  });

  maybeTest("inferred string locals preserve their payload", () => {
    const { wat } = checkedCompile('export fn run(): i32 { let s = "world"; return s.len; }');
    assert.equal(runExport(wat, "run"), 5);
  });

  maybeTest("string .len reads the payload length", () => {
    const { wat } = checkedCompile(
      'export fn run(): i32 { let s: string = "hello"; return s.len; }',
    );
    assert.equal(runExport(wat, "run"), 5);
  });
});

describe("Emission: Struct methods", () => {
  maybeTest("dotted method declarations remain callable", () => {
    const { wat } = checkedCompile(`
      struct Vec2 { x: i32, y: i32, }
      fn Vec2.add(v)(other: Vec2): i32 { return v.x + other.x; }
      export fn run(): i32 {
        let a: Vec2 = { x = 1, y = 2 };
        let b: Vec2 = { x = 3, y = 4 };
        return a.add(b);
      }
    `);
    assert.equal(runExport(wat, "run"), 4);
  });

  maybeTest("method calls pass the receiver before explicit arguments", () => {
    const { wat } = checkedCompile(`
      struct Vec2 { x: i32, y: i32, }
      fn Vec2.add(v)(other: Vec2): i32 { return v.x + other.x; }
      export fn run(): i32 {
        let v: Vec2 = { x = 5, y = 6 };
        let other: Vec2 = { x = 7, y = 8 };
        return v.add(other);
      }
    `);
    assert.equal(runExport(wat, "run"), 12);
  });
});

// ─── Control flow ───────────────────────────────────────────────

describe("Emission: For init", () => {
  maybeTest("for loop starts from a non-zero initializer", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let sum: i32 = 0;
        for (let i: i32 = 5; i < 10; i = i + 1) { sum += i; }
        return sum;
      }
    `);
    assert.equal(runExport(wat, "run"), 35);
  });

  maybeTest("for loop starts from a negative initializer", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let sum: i32 = 0;
        for (let i: i32 = -3; i < 2; i = i + 1) { sum += i; }
        return sum;
      }
    `);
    assert.equal(runExport(wat, "run"), -5);
  });

  maybeTest("for loop starts from a zero initializer", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let sum: i32 = 0;
        for (let i: i32 = 0; i < 3; i = i + 1) { sum += i; }
        return sum;
      }
    `);
    assert.equal(runExport(wat, "run"), 3);
  });
});

describe("Emission: If result type", () => {
  maybeTest("f32-returning branches bypass code after the if", () => {
    const { wat } = checkedCompile(`
      let after: i32 = 0;
      fn choose(x: i32): f32 {
        if (x > 0) { return 1.0; } else { return 2.0; }
        after = 99;
        return 0.0;
      }
      export fn run(x: i32): f32 { return choose(x) + (after as f32); }
    `);
    assert.equal(runExport(wat, "run", [1]), 1);
    assert.equal(runExport(wat, "run", [0]), 2);
  });

  maybeTest("nested f32-returning branches bypass code after the outer if", () => {
    const { wat } = checkedCompile(`
      let after: i32 = 0;
      fn choose(x: i32): f32 {
        if (x > 0) {
          if (x > 1) { return 1.0; } else { return 2.0; }
        } else {
          return 3.0;
        }
        after = 99;
        return 0.0;
      }
      export fn run(x: i32): f32 { return choose(x) + (after as f32); }
    `);
    assert.equal(runExport(wat, "run", [2]), 1);
    assert.equal(runExport(wat, "run", [1]), 2);
    assert.equal(runExport(wat, "run", [0]), 3);
  });

  maybeTest("void-returning branches bypass code after the if", () => {
    const { wat } = checkedCompile(`
      let reached: i32 = 0;
      fn choose(x: i32): void {
        if (x > 0) { reached = 1; return; } else { reached = 2; return; }
        reached = 99;
      }
      export fn run(x: i32): i32 { choose(x); return reached; }
    `);
    assert.equal(runExport(wat, "run", [1]), 1);
    assert.equal(runExport(wat, "run", [0]), 2);
  });

  maybeTest("i32-returning branches bypass code after the if", () => {
    const { wat } = checkedCompile(`
      let after: i32 = 0;
      fn choose(x: i32): i32 {
        if (x > 0) { return 1; } else { return 2; }
        after = 99;
        return 0;
      }
      export fn run(x: i32): i32 { return choose(x) + after; }
    `);
    assert.equal(runExport(wat, "run", [1]), 1);
    assert.equal(runExport(wat, "run", [0]), 2);
  });
});

describe("Emission: Loop conditions", () => {
  test("checker rejects a void function as an if condition", () => {
    assert(
      checkerMessages(`fn noop(): void {} fn f(): void { if (noop()) { return; } }`).some(
        (message) => message.includes("void call used as a value"),
      ),
    );
  });

  maybeTest("an f32 if condition uses numeric truthiness", () => {
    const { wat } = checkedCompile(`
      export fn run(x: f32): i32 { if (x) { return 1; } return 0; }
    `);
    assert.equal(runExport(wat, "run", [1.5]), 1);
    assert.equal(runExport(wat, "run", [0]), 0);
  });

  maybeTest("an i32 if condition uses numeric truthiness", () => {
    const { wat } = checkedCompile(`
      export fn run(x: i32): i32 { if (x) { return 1; } return 0; }
    `);
    assert.equal(runExport(wat, "run", [-3]), 1);
    assert.equal(runExport(wat, "run", [0]), 0);
  });

  test("checker rejects a void function as a for condition", () => {
    assert(
      checkerMessages(
        `fn noop(): void {} fn f(): void { for (let i: i32 = 0; noop(); i = i + 1) { } }`,
      ).some((message) => message.includes("void call used as a value")),
    );
  });

  test("checker rejects a void function as a while condition", () => {
    assert(
      checkerMessages(`fn noop(): void {} fn f(): void { while (noop()) { } }`).some((message) =>
        message.includes("void call used as a value"),
      ),
    );
  });

  maybeTest("an f32 for condition is rechecked", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let x: f32 = 1.0;
        let count: i32 = 0;
        for (let i: i32 = 0; x; i = i + 1) { count++; x = 0.0; }
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("a bool while condition is rechecked", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let active: bool = true;
        let count: i32 = 0;
        while (active) { count++; active = false; }
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("an i32 while condition is rechecked", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let i: i32 = 3;
        let count: i32 = 0;
        while (i) { count++; i--; }
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 3);
  });
});

describe("Emission: Break/Continue outside loop", () => {
  test("checker rejects break outside any loop or switch", () => {
    assert(
      checkerMessages("fn f(): void { break; }").some((message) =>
        message.includes("break statement must be inside a loop or switch"),
      ),
    );
  });

  test("checker rejects continue outside any loop", () => {
    assert(
      checkerMessages("fn f(): void { continue; }").some((message) =>
        message.includes("continue statement must be inside a loop"),
      ),
    );
  });

  maybeTest("break exits a for loop", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let count: i32 = 0;
        for (let i: i32 = 0; i < 5; i = i + 1) { count++; break; }
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("continue in a for loop still performs the update", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let count: i32 = 0;
        for (let i: i32 = 0; i < 5; i = i + 1) { continue; count++; }
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 0);
  });

  maybeTest("break exits a while loop", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let count: i32 = 0;
        while (1) { count++; break; }
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("continue in a while loop rechecks the condition", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let i: i32 = 0;
        while (i < 5) { i = i + 1; continue; }
        return i;
      }
    `);
    assert.equal(runExport(wat, "run"), 5);
  });
});

describe("Emission: Switch break", () => {
  maybeTest("break exits a standalone switch", () => {
    const { wat } = checkedCompile(`
      export fn run(x: i32): i32 {
        let result: i32 = 0;
        switch (x) {
          case 0: { result = 10; break; }
          default: { result = 20; break; }
        }
        return result + 1;
      }
    `);
    assert.equal(runExport(wat, "run", [0]), 11);
    assert.equal(runExport(wat, "run", [1]), 21);
  });

  maybeTest("break inside a switch does not exit its enclosing for loop", () => {
    const { wat } = checkedCompile(`
      export fn run(x: i32): i32 {
        let count: i32 = 0;
        for (let i: i32 = 0; i < 3; i = i + 1) {
          switch (x) {
            case 0: { break; }
            default: { break; }
          }
          count++;
        }
        return count;
      }
    `);
    assert.equal(runExport(wat, "run", [0]), 3);
    assert.equal(runExport(wat, "run", [1]), 3);
  });

  maybeTest("continue inside a switch targets its enclosing for loop", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let count: i32 = 0;
        for (let i: i32 = 0; i < 5; i = i + 1) {
          switch (i) {
            case 2: { continue; }
            default: { break; }
          }
          count++;
        }
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 4);
  });

  maybeTest("switch cases do not fall through", () => {
    const { wat } = checkedCompile(`
      export fn run(x: i32): i32 {
        let result: i32 = 0;
        switch (x) {
          case 0: { result = 10; }
          case 1: { result = 20; }
          default: { result = 99; }
        }
        return result;
      }
    `);
    assert.equal(runExport(wat, "run", [0]), 10);
    assert.equal(runExport(wat, "run", [1]), 20);
    assert.equal(runExport(wat, "run", [2]), 99);
  });
});

describe("Emission: Nested constructs", () => {
  maybeTest("break in an inner for loop leaves the outer loop running", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let count: i32 = 0;
        for (let i: i32 = 0; i < 3; i = i + 1) {
          for (let j: i32 = 0; j < 3; j = j + 1) {
            count++;
            break;
          }
        }
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 3);
  });

  maybeTest("break inside an if exits the enclosing for loop", () => {
    const { wat } = checkedCompile(`
      export fn run(): i32 {
        let count: i32 = 0;
        for (let i: i32 = 0; i < 5; i = i + 1) {
          count++;
          if (i > 2) { break; }
        }
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 4);
  });

  maybeTest("return inside a for loop exits its enclosing function", () => {
    const { wat } = checkedCompile(`
      export fn run(x: i32): i32 {
        if (x > 0) {
          for (let i: i32 = 0; i < x; i = i + 1) {
            return i + 10;
          }
        }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "run", [3]), 10);
    assert.equal(runExport(wat, "run", [0]), 0);
  });
});

describe("Emission: Flow analysis", () => {
  maybeTest("a switch without default can reach code after its if", () => {
    const { wat } = checkedCompile(`
      let after: i32 = 0;
      fn choose(x: i32, y: i32): i32 {
        if (x > 0) {
          switch (y) {
            case 0: { return 1; }
          }
        } else {
          return 2;
        }
        after = 3;
        return after;
      }
      export fn run(x: i32, y: i32): i32 { return choose(x, y); }
    `);
    assert.equal(runExport(wat, "run", [1, 0]), 1);
    assert.equal(runExport(wat, "run", [1, 1]), 3);
    assert.equal(runExport(wat, "run", [-1, 0]), 2);
  });

  maybeTest("a zero-iteration for loop can reach code after its if", () => {
    const { wat } = checkedCompile(`
      let after: i32 = 0;
      fn choose(branch: i32, limit: i32): i32 {
        if (branch > 0) {
          for (let i: i32 = 0; i < limit; i = i + 1) {
            return 1;
          }
        } else {
          return -1;
        }
        after = 4;
        return after;
      }
      export fn run(branch: i32, limit: i32): i32 { return choose(branch, limit); }
    `);
    assert.equal(runExport(wat, "run", [1, 2]), 1);
    assert.equal(runExport(wat, "run", [1, 0]), 4);
    assert.equal(runExport(wat, "run", [-1, 2]), -1);
  });

  maybeTest("a zero-iteration while loop can reach code after its if", () => {
    const { wat } = checkedCompile(`
      let after: i32 = 0;
      fn choose(branch: i32, limit: i32): i32 {
        if (branch > 0) {
          while (limit > 0) {
            return 1;
          }
        } else {
          return -1;
        }
        after = 4;
        return after;
      }
      export fn run(branch: i32, limit: i32): i32 { return choose(branch, limit); }
    `);
    assert.equal(runExport(wat, "run", [1, 2]), 1);
    assert.equal(runExport(wat, "run", [1, 0]), 4);
    assert.equal(runExport(wat, "run", [-1, 2]), -1);
  });

  maybeTest("both returning branches cannot reach code after the if", () => {
    const { wat } = checkedCompile(`
      let after: i32 = 0;
      fn choose(x: i32): i32 {
        if (x > 0) { return 1; } else { return -1; }
        after = 99;
        return 0;
      }
      export fn run(x: i32): i32 { return choose(x) + after; }
    `);
    assert.equal(runExport(wat, "run", [1]), 1);
    assert.equal(runExport(wat, "run", [0]), -1);
  });
});

// ─── Memory-Backed Local Structs ──────────────────────────────────────────

describe("Emission: Shadow stack global", () => {
  maybeTest("a local struct frame preserves member values", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 1, y = 2 };
        return p.x * 10 + p.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 12);
  });

  maybeTest("recursive local struct frames remain isolated", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      fn recurse(n: i32): i32 {
        let p: Point = { x = n, y = n + 10 };
        if (n > 0) {
          let inner: i32 = recurse(n - 1);
          return p.x * 100 + p.y + inner;
        }
        return p.x * 100 + p.y;
      }
      export fn run(): i32 { return recurse(2); }
    `);
    assert.equal(runExport(wat, "run"), 333);
  });
});

describe("Emission: Local declaration — flat locals gone", () => {
  maybeTest("local struct fields remain independent after mutation", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 2, y = 3 };
        p.x = 7;
        return p.x * 10 + p.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 73);
  });

  maybeTest("local struct members round-trip at every scalar width", () => {
    const { wat } = checkedCompile(`
      struct Widths {
        signed8: i8,
        unsigned8: u8,
        signed16: i16,
        unsigned16: u16,
        signed32: i32,
        unsigned32: u32,
        signed64: i64,
        unsigned64: u64,
        float32: f32,
        float64: f64,
        flag: bool,
      }
      export fn run(): i32 {
        let w: Widths = {
          signed8 = -7,
          unsigned8 = 250,
          signed16 = -30000,
          unsigned16 = 60000,
          signed32 = -123456,
          unsigned32 = 123456,
          signed64 = 8 as i64,
          unsigned64 = 9 as u64,
          float32 = 1.5,
          float64 = 2.25 as f64,
          flag = true,
        };
        return
          (w.signed8 == -7) +
          (w.unsigned8 == 250) +
          (w.signed16 == -30000) +
          (w.unsigned16 == 60000) +
          (w.signed32 == -123456) +
          (w.unsigned32 == 123456) +
          (w.signed64 == (8 as i64)) +
          (w.unsigned64 == (9 as u64)) +
          (w.float32 == 1.5) +
          (w.float64 == (2.25 as f64)) +
          (w.flag == true);
      }
    `);
    assert.equal(runExport(wat, "run"), 11);
  });
});

describe("Emission: Field init — stores to memory", () => {
  maybeTest("the first i32 field initializes without disturbing its neighbor", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 2, y = 3 };
        return p.x * 10 + p.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 23);
  });

  maybeTest("the second i32 field initializes without disturbing its neighbor", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 2, y = 3 };
        return p.y * 10 + p.x;
      }
    `);
    assert.equal(runExport(wat, "run"), 32);
  });

  maybeTest("mixed i32 and f32 fields retain their own values", () => {
    const { wat } = checkedCompile(`
      struct Mixed { a: i32, b: f32 }
      export fn run(): i32 {
        let m: Mixed = { a = 1, b = 3.14 };
        return m.a + (m.b as i32);
      }
    `);
    assert.equal(runExport(wat, "run"), 4);
  });

  maybeTest("two f32 fields initialize independently", () => {
    const { wat } = checkedCompile(`
      struct Vec2 { x: f32, y: f32 }
      export fn run(): f32 {
        let v: Vec2 = { x = 1.5, y = 2.5 };
        return v.x * 10.0 + v.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 17.5);
  });

  maybeTest("a single-field struct preserves its initializer", () => {
    const { wat } = checkedCompile(`
      struct Single { val: i32 }
      export fn run(): i32 {
        let s: Single = { val = 42 };
        return s.val;
      }
    `);
    assert.equal(runExport(wat, "run"), 42);
  });

  maybeTest("expression-valued fields preserve their computed results", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(a: i32, b: i32): i32 {
        let p: Point = { x = a + 1, y = b * 2 };
        return p.x * 10 + p.y;
      }
    `);
    assert.equal(runExport(wat, "run", [2, 4]), 38);
  });
});

describe("Emission: Member read — loads from memory", () => {
  maybeTest("reading p.x returns the first field", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 { let p: Point = { x = 3, y = 4 }; return p.x; }
    `);
    assert.equal(runExport(wat, "run"), 3);
  });

  maybeTest("reading p.y returns the second field", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 { let p: Point = { x = 3, y = 4 }; return p.y; }
    `);
    assert.equal(runExport(wat, "run"), 4);
  });

  maybeTest("reading an f32 member returns its value", () => {
    const { wat } = checkedCompile(`
      struct Vec2 { x: f32, y: f32 }
      export fn run(): f32 { let v: Vec2 = { x = 1.5, y = 2.5 }; return v.x; }
    `);
    assert.equal(runExport(wat, "run"), 1.5);
  });

  maybeTest("multiple member reads compose in arithmetic", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 { let p: Point = { x = 3, y = 4 }; return p.x + p.y; }
    `);
    assert.equal(runExport(wat, "run"), 7);
  });

  maybeTest("member reads compose in comparisons", () => {
    const { wat } = checkedCompile(`
      struct Counter { n: i32 }
      export fn run(): i32 {
        let c: Counter = { n = 5 };
        if (c.n > 0) { return 1; }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("member reads compose with prefix negation", () => {
    const { wat } = checkedCompile(`
      struct Num { val: i32 }
      export fn run(): i32 { let n: Num = { val = 7 }; return -n.val; }
    `);
    assert.equal(runExport(wat, "run"), -7);
  });

  maybeTest("member reads drive while-loop conditions", () => {
    const { wat } = checkedCompile(`
      struct Flag { active: i32 }
      export fn run(): i32 {
        let f: Flag = { active = 1 };
        let count: i32 = 0;
        while (f.active) { count++; f.active = 0; }
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("member reads drive for-loop conditions", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 5, y = 0 };
        for (let i: i32 = 0; p.x > 0; i = i + 1) { p.x = p.x - 1; }
        return p.x;
      }
    `);
    assert.equal(runExport(wat, "run"), 0);
  });

  maybeTest("member reads drive if conditions", () => {
    const { wat } = checkedCompile(`
      struct Counter { n: i32 }
      export fn run(): i32 {
        let c: Counter = { n = 5 };
        if (c.n) { return 1; }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("member reads pass through function arguments", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      fn bar(n: i32): i32 { return n; }
      export fn run(): i32 { let p: Point = { x = 7, y = 0 }; return bar(p.x); }
    `);
    assert.equal(runExport(wat, "run"), 7);
  });
});

describe("Emission: Member write — stores to memory", () => {
  maybeTest("writing p.x preserves p.y", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 0, y = 7 };
        p.x = 10;
        return p.x * 10 + p.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 107);
  });

  maybeTest("writing p.y preserves p.x", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 7, y = 0 };
        p.y = 20;
        return p.x * 100 + p.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 720);
  });

  maybeTest("member writes read back from the same field", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 0, y = 0 };
        p.x = 99;
        return p.x;
      }
    `);
    assert.equal(runExport(wat, "run"), 99);
  });
});

describe("Emission: Prologue / epilogue", () => {
  maybeTest("one local struct receives an isolated frame", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 1, y = 2 };
        return p.x * 10 + p.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 12);
  });

  maybeTest("sequential local struct calls preserve their own values", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      fn sample(value: i32): i32 {
        let p: Point = { x = value, y = value + 1 };
        return p.x * 10 + p.y;
      }
      export fn run(): i32 { return sample(1) * 100 + sample(3); }
    `);
    assert.equal(runExport(wat, "run"), 1_234);
  });

  maybeTest("frame setup precedes field initialization", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 1, y = 2 };
        p.y = p.x + 4;
        return p.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 5);
  });

  maybeTest("two local structs do not overlap", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 1, y = 2 };
        let q: Point = { x = 3, y = 4 };
        p.x = 5;
        q.y = 6;
        return p.x * 1000 + p.y * 100 + q.x * 10 + q.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 5_236);
  });

  maybeTest("a four-field struct preserves every field", () => {
    const { wat } = checkedCompile(`
      struct Big { a: i32, b: i32, c: i32, d: i32 }
      export fn run(): i32 {
        let value: Big = { a = 1, b = 2, c = 3, d = 4 };
        return value.a + value.b + value.c + value.d;
      }
    `);
    assert.equal(runExport(wat, "run"), 10);
  });
});

describe("Emission: Pointer initialization", () => {
  maybeTest("the first local struct points at its initialized fields", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 1, y = 2 };
        return p.x * 10 + p.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 12);
  });

  maybeTest("the second local struct points at distinct initialized fields", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 1, y = 2 };
        let q: Point = { x = 3, y = 4 };
        q.x = 8;
        return p.x * 1000 + p.y * 100 + q.x * 10 + q.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 1_284);
  });

  maybeTest("pointer initialization precedes expression-valued field stores", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(seed: i32): i32 {
        let p: Point = { x = seed + 1, y = seed + 2 };
        return p.x * 10 + p.y;
      }
    `);
    assert.equal(runExport(wat, "run", [3]), 45);
  });
});

describe("Emission: Return with SP restore via $__ret_tmp", () => {
  maybeTest("a value return preserves a local struct member", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 { let p: Point = { x = 3, y = 4 }; return p.x; }
    `);
    assert.equal(runExport(wat, "run"), 3);
  });

  maybeTest("repeated early void returns do not leak their frames", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      let visits: i32 = 0;
      fn touch(): void {
        let p: Point = { x = 1, y = 2 };
        visits += p.x;
        return;
      }
      export fn run(): i32 {
        for (let i: i32 = 0; i < 10000; i = i + 1) { touch(); }
        return visits;
      }
    `);
    assert.equal(runExport(wat, "run"), 10_000);
  });

  maybeTest("a scalar return remains intact when a local struct exists", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 1, y = 2 };
        return 42;
      }
    `);
    assert.equal(runExport(wat, "run"), 42);
  });

  maybeTest("multiple value-return paths restore their frames", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      fn choose(cond: i32): i32 {
        let p: Point = { x = 3, y = 4 };
        if (cond > 0) { return p.x; }
        return p.y;
      }
      export fn run(): i32 {
        let total: i32 = 0;
        for (let i: i32 = 0; i < 10000; i = i + 1) { total += choose(1); }
        return total + choose(0);
      }
    `);
    assert.equal(runExport(wat, "run"), 30_004);
  });

  maybeTest("an f32 return remains intact when a local struct exists", () => {
    const { wat } = checkedCompile(`
      struct Vec2 { x: f32, y: f32 }
      export fn run(): f32 { let v: Vec2 = { x = 1.5, y = 2.5 }; return v.x; }
    `);
    assert.equal(runExport(wat, "run"), 1.5);
  });

  maybeTest("a void function with a local struct returns normally", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      let seen: i32 = 0;
      fn touch(): void {
        let p: Point = { x = 1, y = 2 };
        seen = p.x * 10 + p.y;
      }
      export fn run(): i32 { touch(); return seen; }
    `);
    assert.equal(runExport(wat, "run"), 12);
  });
});

describe("Emission: Negative assertions — flat locals gone", () => {
  maybeTest("member writes preserve neighboring fields", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 3, y = 4 };
        p.x = 10;
        return p.x + p.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 14);
  });

  maybeTest("break and continue do not restore a live local-struct frame", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      fn loop(): i32 {
        let p: Point = { x = 5, y = 0 };
        while (p.x > 0) {
          p.x = p.x - 1;
          if (p.x == 2) { continue; }
          if (p.x == 1) { break; }
        }
        return p.x;
      }
      export fn run(): i32 {
        let total: i32 = 0;
        for (let i: i32 = 0; i < 10000; i = i + 1) { total += loop(); }
        return total;
      }
    `);
    assert.equal(runExport(wat, "run"), 10_000);
  });
});

describe("Emission: Global struct regression", () => {
  maybeTest("global structs materialize their initialized fields", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      let g: Point = { x = 2, y = 3 };
      export fn run(): i32 { return g.x * 10 + g.y; }
    `);
    assert.equal(runExport(wat, "run"), 23);
  });

  maybeTest("global struct bindings retain their initialized values", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      let g: Point = { x = 2, y = 3 };
      export fn run(): i32 { return g.y * 10 + g.x; }
    `);
    assert.equal(runExport(wat, "run"), 32);
  });

  maybeTest("global struct members read back", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      let g: Point = { x = 2, y = 3 };
      export fn run(): i32 { return g.x; }
    `);
    assert.equal(runExport(wat, "run"), 2);
  });

  maybeTest("global struct member writes preserve neighboring fields", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      let g: Point = { x = 2, y = 3 };
      export fn run(): i32 { g.x = 5; return g.x * 10 + g.y; }
    `);
    assert.equal(runExport(wat, "run"), 53);
  });
});

describe("Emission: Param struct regression", () => {
  maybeTest("struct parameters expose each member", () => {
    const { wat } = checkedCompile(`
      struct Pair { a: i32, b: i32 }
      fn sum(p: Pair): i32 { return p.a + p.b; }
      export fn run(): i32 {
        let p: Pair = { a = 3, b = 4 };
        return sum(p);
      }
    `);
    assert.equal(runExport(wat, "run"), 7);
  });

  maybeTest("struct parameter arithmetic uses the member type", () => {
    const { wat } = checkedCompile(`
      struct Pair { a: i32, b: i32 }
      fn sum(p: Pair): i32 { return p.a + p.b; }
      export fn run(): i32 {
        let p: Pair = { a = -3, b = 4 };
        return sum(p);
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });
});

describe("Emission: Method calls on local structs", () => {
  maybeTest("a method reads its local-struct receiver", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      fn Point.sum(p)(): i32 { return p.x + p.y; }
      export fn run(): i32 { let p: Point = { x = 3, y = 4 }; return p.sum(); }
    `);
    assert.equal(runExport(wat, "run"), 7);
  });

  maybeTest("a method preserves independent receiver fields", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      fn Point.sum(p)(): i32 { return p.x + p.y; }
      export fn run(): i32 {
        let p: Point = { x = 3, y = 4 };
        p.x = 8;
        return p.sum();
      }
    `);
    assert.equal(runExport(wat, "run"), 12);
  });

  maybeTest("a method receives another local struct as an argument", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      fn Point.add(self)(other: Point): i32 { return self.x + other.x; }
      export fn run(): i32 {
        let a: Point = { x = 1, y = 2 };
        let b: Point = { x = 3, y = 4 };
        return a.add(b);
      }
    `);
    assert.equal(runExport(wat, "run"), 4);
  });
});

describe("Emission: Struct member in various expressions", () => {
  maybeTest("a struct member selects a switch case", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 1, y = 0 };
        switch (p.x) {
          case 0: { return 0; }
          case 1: { return 1; }
          default: { return 2; }
        }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("repeated struct member reads compose in a binary chain", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 { let p: Point = { x = 2, y = 3 }; return p.x * p.y + p.x; }
    `);
    assert.equal(runExport(wat, "run"), 8);
  });

  maybeTest("a struct member can be cast to f32", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): f32 { let p: Point = { x = 5, y = 0 }; return p.x as f32; }
    `);
    assert.equal(runExport(wat, "run"), 5);
  });

  maybeTest("a struct member initializes a scalar local", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 7, y = 0 };
        let total: i32 = p.x;
        total++;
        return total;
      }
    `);
    assert.equal(runExport(wat, "run"), 8);
  });
});

describe("Emission: Struct in control flow bodies", () => {
  maybeTest("a local struct inside an if retains its fields", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(cond: i32): i32 {
        if (cond > 0) {
          let p: Point = { x = 1, y = 2 };
          return p.x * 10 + p.y;
        }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "run", [1]), 12);
    assert.equal(runExport(wat, "run", [0]), 0);
  });

  maybeTest("a local struct inside a while body retains its fields", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let i: i32 = 0;
        let total: i32 = 0;
        while (i < 1) {
          let p: Point = { x = 5, y = 6 };
          total = p.x * 10 + p.y;
          i = i + 1;
        }
        return total;
      }
    `);
    assert.equal(runExport(wat, "run"), 56);
  });

  maybeTest("struct field writes inside a loop accumulate", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Point = { x = 5, y = 0 };
        while (p.x > 0) {
          p.x = p.x - 1;
          p.y = p.y + 1;
        }
        return p.y;
      }
    `);
    assert.equal(runExport(wat, "run"), 5);
  });
});

describe("Emission: extractGlobalData — local struct skipped", () => {
  maybeTest("local struct literals initialize at call time", () => {
    const { wat } = checkedCompile(`
      struct Point { x: i32, y: i32 }
      fn sample(seed: i32): i32 {
        let p: Point = { x = seed, y = seed + 1 };
        return p.x * 10 + p.y;
      }
      export fn run(): i32 { return sample(3) * 100 + sample(7); }
    `);
    assert.equal(runExport(wat, "run"), 3_478);
  });
});

describe("host surface (WAT-structural)", () => {
  test("exports functions and owns memory by default", () => {
    const { wat } = compile("export fn run(): i32 { return 1; }");
    const exportPattern = /\(\s*func\s+\$run(?:_\d+)?\s+\(\s*export\s+"run"\s*\)/;
    const memoryPattern = /\(\s*memory\s+\(\s*export\s+"memory"\s*\)\s+2\s*\)/;
    assert.match(wat, exportPattern);
    assert.match(wat, memoryPattern);
    assert.doesNotMatch(wat, /\(\s*import\s+"runtime"\s+"memory"/);
  });

  test("retains stdlib function and global imports", () => {
    const { wat } = compile(`
      import PI, sqrt, floor, abs_f32, sqrt_f64, abs_i32, sin, atan2, pow, fmod from "math"
      export fn run(): f32 { return PI; }
    `);
    assert.match(wat, /\(\s*import\s+"math"\s+"PI"\s+\(\s*global\s+\$PI(?:_\d+)?\s+f32\s*\)\s*\)/);
    for (const name of [
      "sqrt",
      "floor",
      "abs_f32",
      "sqrt_f64",
      "abs_i32",
      "sin",
      "atan2",
      "pow",
      "fmod",
    ]) {
      assert.match(wat, new RegExp(`\\(\\s*import\\s+"math"\\s+"${name}"\\s+\\(\\s*func\\b`));
    }
  });

  test("retains the function-reference table, element, signature, and private trampoline", () => {
    const { wat } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      export fn run(): i32 {
        let op: fn(i32,i32):i32 = add;
        return op(1, 2);
      }
    `);
    assert.match(wat, /\(\s*table\s+\$__fn_table\s+1\s+1\s+funcref\s*\)/);
    assert.match(
      wat,
      /\(\s*elem\s+\(\s*i32\.const\s+0\s*\)\s+func\s+\$__indirect_add(?:_\d+)?\s*\)/,
    );
    assert.match(
      wat,
      /\(\s*type\s+\$[^\s()]+\s+\(\s*func\s+(?:(?:\(\s*param\s+i32\s*\)\s*){3}|\(\s*param\s+i32\s+i32\s+i32\s*\)\s*)\(\s*result\s+i32\s*\)\s*\)\s*\)/,
    );
    assert.match(wat, /\(\s*import\s+"memory"\s+"malloc"\s+\(\s*func\b/);
    assert.doesNotMatch(wat, /\(\s*export\s+"[^"]*"\s+\(\s*func\s+\$__indirect_/);
    assert.doesNotMatch(wat, /\b__fn_table_inited\b/);
    assert.doesNotMatch(wat, /\btable\.set\b/);
  });

  test("active elements follow deterministic slots and share one signature", () => {
    const { wat } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn sub(a: i32, b: i32): i32 { return a - b; }
      export fn run(): i32 {
        let second: fn(i32,i32):i32 = sub;
        let first: fn(i32,i32):i32 = add;
        return first(3, 2) + second(3, 2);
      }
    `);
    assert.match(wat, /\(\s*table\s+\$__fn_table\s+2\s+2\s+funcref\s*\)/);
    assert.match(
      wat,
      /\(\s*elem\s+\(\s*i32\.const\s+0\s*\)\s+func\s+\$__indirect_sub(?:_\d+)?\s+\$__indirect_add(?:_\d+)?\s*\)/,
    );
    assert.equal(
      (
        wat.match(
          /\(\s*type\s+\$[^\s()]+\s+\(\s*func\s+(?:(?:\(\s*param\s+i32\s*\)\s*){3}|\(\s*param\s+i32\s+i32\s+i32\s*\)\s*)\(\s*result\s+i32\s*\)\s*\)\s*\)/g,
        ) ?? []
      ).length,
      1,
    );
  });

  test("omits the closure runtime when no function references exist", () => {
    const { wat } = compile("export fn add(a: i32, b: i32): i32 { return a + b; }");
    assert.doesNotMatch(wat, /\(\s*table\b/);
    assert.doesNotMatch(wat, /\b__make_fnref\b/);
    assert.doesNotMatch(wat, /\(\s*import\s+"memory"\s+"malloc"/);
  });

  test("retains the environment lane for void function references", () => {
    const { wat } = compile(`
      fn noop(): void {}
      export fn run(): void { let cb: fn():void = noop; cb(); }
    `);
    assert.match(wat, /\(\s*type\s+\$[^\s()]+\s+\(\s*func\s+\(\s*param\s+i32\s*\)\s*\)\s*\)/);
  });

  test("module-surface regexes tolerate equivalent reformatting", () => {
    assert.match(
      '( func\n  $run\n  ( export "run" ) )',
      /\(\s*func\s+\$run\s+\(\s*export\s+"run"\s*\)/,
    );
    assert.match(
      "( table\n  $__fn_table 1 1 funcref )",
      /\(\s*table\s+\$__fn_table\s+1\s+1\s+funcref\s*\)/,
    );
    assert.match(
      "( elem\n  ( i32.const 0 )\n  func $__indirect_add )",
      /\(\s*elem\s+\(\s*i32\.const\s+0\s*\)\s+func\s+\$__indirect_add\s*\)/,
    );
  });

  test("global expression fields initialize through start without legacy guards", () => {
    const { wat } = compile(`
      let offset: i32 = 9;
      struct Point { x: i32, y: i32 }
      let g: Point = { x = offset, y = 0 };
      export fn run(): i32 { return g.x; }
    `);
    assert.equal((wat.match(/\(\s*start\b/g) ?? []).length, 1, wat);
    assert.doesNotMatch(wat, /\b__globals_inited\b|\b__fn_table_inited\b/);
    assert.match(wat, /\bi32\.store\b/);
    assert.match(wat, /\bglobal\.get\s+\$offset(?:_\d+)?\b/);
  });

  test("start is emitted once instead of guards in exported functions", () => {
    const { wat } = compile(`
      let offset: i32 = 9;
      struct Point { x: i32, y: i32 }
      let g: Point = { x = offset, y = 0 };
      fn helper(): i32 { return g.x; }
      export fn run(): i32 { return helper(); }
    `);
    assert.equal((wat.match(/\(\s*start\b/g) ?? []).length, 1, wat);
    assert.doesNotMatch(wat, /\b__globals_inited\b|\b__fn_table_inited\b/);
  });

  test("start exists exactly when runtime initializers exist", () => {
    const initialized = compile(`
      fn seed(): i32 { return 9; }
      let value: i32 = seed();
      export fn run(): i32 { return value; }
    `).wat;
    const literalOnly = compile(`
      struct Point { x: i32, y: i32 }
      let g: Point = { x = 2, y = 3 };
      export fn run(): i32 { return g.x; }
    `).wat;
    assert.equal((initialized.match(/\(\s*start\b/g) ?? []).length, 1, initialized);
    assert.doesNotMatch(literalOnly, /\(\s*start\b/);
  });

  test("literal-only global structs emit neither start nor legacy guards", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      let g: Point = { x = 2, y = 3 };
      export fn run(): i32 { return g.x; }
    `);
    assert.doesNotMatch(wat, /\(\s*start\b/);
    assert.doesNotMatch(wat, /\b__globals_inited\b|\b__fn_table_inited\b/);
  });

  test("f32 expression field uses f32.store in init block", () => {
    const { wat } = compile(`
      let seed: f32 = 1.5;
      struct Vec2 { x: f32, y: f32 }
      let v: Vec2 = { x = seed, y = 0.0 };
      export fn run(): f32 { return v.x; }
    `);
    assert.match(wat, /\bf32\.store\b/);
    assert.match(wat, /\bglobal\.get\s+\$seed(?:_\d+)?\b/);
  });

  test("mixed literal and expression fields emit one deferred store", () => {
    const { wat } = compile(`
      let offset: i32 = 11;
      struct Point { x: i32, y: i32 }
      let g: Point = { x = offset, y = 7 };
      export fn run(): i32 { return g.y; }
    `);
    const storeCount = (wat.match(/\bi32\.store\b/g) || []).length;
    assert.equal(
      storeCount,
      1,
      `Expected one i32.store from deferred init, got ${storeCount}:\n${wat}`,
    );
  });

  test("multiple global expression fields emit multiple deferred stores", () => {
    const { wat } = compile(`
      let a: i32 = 3;
      let b: i32 = 5;
      struct Point { x: i32, y: i32 }
      let g1: Point = { x = a, y = 0 };
      let g2: Point = { x = b, y = 0 };
      export fn run(): i32 { return g1.x + g2.x; }
    `);
    const storeCount = (wat.match(/\bi32\.store\b/g) || []).length;
    assert.equal(storeCount, 2, `Expected two deferred i32.store ops, got ${storeCount}:\n${wat}`);
  });

  test("global struct reversed literal field order still stores by struct layout", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      let g: Point = { y = 2, x = 1 };
      export fn run(): i32 { return g.x; }
    `);
    assert.match(wat, /\(\s*data\s+\(\s*(?:offset\s+)?\(\s*i32\.const\b/);
    assert(
      wat.includes("\\01\\00\\00\\00\\02\\00\\00\\00"),
      `Expected x then y byte ordering in data segment:\n${wat}`,
    );
  });
});

describe("Compiler: inferred function call types", () => {
  maybeTest("inferred i32 call results preserve their value", () => {
    const { wat } = checkedCompile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      export fn run(): i32 { let x = add(1, 2); return x; }
    `);
    assert.equal(runExport(wat, "run"), 3);
  });

  maybeTest("inferred f32 call results preserve their value", () => {
    const { wat } = checkedCompile(`
      fn half(x: f32): f32 { return x; }
      export fn run(): f32 { let y = half(1.5); return y; }
    `);
    assert.equal(runExport(wat, "run"), 1.5);
  });
});

describe("Emission: multi-return and destructure", () => {
  maybeTest("multi-return functions expose every result", () => {
    const { wat } = checkedCompile(`
      export fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
    `);
    assert.deepEqual(runExport(wat, "swap", [1, 2]), [2, 1]);
  });

  test("multi-return signature encodes all result lanes", () => {
    const { meta } = compile("fn pair(): (i32, i64) { return 1, 2 as i64; }");
    assert.equal(meta.functions.pair?.signature, "v_iI");
  });

  maybeTest("three-return signatures and values retain every lane", () => {
    const { meta, wat } = checkedCompile("export fn tri(): (i32, i32, i32) { return 1, 2, 3; }");
    assert.equal(meta.functions.tri?.signature, "v_iii");
    assert.deepEqual(runExport(wat, "tri"), [1, 2, 3]);
  });

  maybeTest("five-return signatures and values retain every lane", () => {
    const { meta, wat } = checkedCompile(`
      export fn many(): (i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5; }
    `);
    assert.equal(meta.functions.many?.signature, "v_iiiii");
    assert.deepEqual(runExport(wat, "many"), [1, 2, 3, 4, 5]);
  });

  maybeTest("six-return signatures and values retain every lane", () => {
    const { meta, wat } = checkedCompile(`
      export fn many6(): (i32, i32, i32, i32, i32, i32) {
        return 1, 2, 3, 4, 5, 6;
      }
    `);
    assert.equal(meta.functions.many6?.signature, "v_iiiiii");
    assert.deepEqual(runExport(wat, "many6"), [1, 2, 3, 4, 5, 6]);
  });

  maybeTest("multi-value return expressions preserve source order", () => {
    const { wat } = checkedCompile("export fn pair(): (i32, i32) { return 1, 2; }");
    assert.deepEqual(runExport(wat, "pair"), [1, 2]);
  });

  maybeTest("pass-through returns preserve every result", () => {
    const { wat } = checkedCompile(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      export fn pass(): (i32, i32) { return swap(1, 2); }
    `);
    assert.deepEqual(runExport(wat, "pass"), [2, 1]);
  });

  maybeTest("destructuring binds multi-return values by position", () => {
    const { wat } = checkedCompile(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      export fn run(): i32 { let (x, y) = swap(1, 2); return x * 10 + y; }
    `);
    assert.equal(runExport(wat, "run"), 21);
  });

  maybeTest("destructuring wildcards discard only their position", () => {
    const { wat } = checkedCompile(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      export fn run(): i32 { let (_, y) = swap(1, 2); return y; }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("destructured locals preserve their individual result types", () => {
    const { wat } = checkedCompile(`
      fn pair(): (i32, i64) { return 1, 2 as i64; }
      export fn run(): i64 { let (x, y) = pair(); return y + (x as i64); }
    `);
    assert.equal(runExport(wat, "run"), 3n);
  });

  maybeTest("statement-position multi-return calls discard every result", () => {
    const { wat } = checkedCompile(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      export fn run(): i32 { swap(1, 2); return 7; }
    `);
    assert.equal(runExport(wat, "run"), 7);
  });

  maybeTest("statement-position five-return calls discard every result", () => {
    const { wat } = checkedCompile(`
      fn many(): (i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5; }
      export fn run(): i32 { many(); return 9; }
    `);
    assert.equal(runExport(wat, "run"), 9);
  });

  maybeTest("five-return destructuring combines bindings and wildcards", () => {
    const { wat } = checkedCompile(`
      fn many(): (i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5; }
      export fn run(): i32 {
        let (a, _, c, d, e) = many();
        return a * 1000 + c * 100 + d * 10 + e;
      }
    `);
    assert.equal(runExport(wat, "run"), 1_345);
  });

  maybeTest("single-return frame functions preserve their result", () => {
    const { wat } = checkedCompile(`
      struct P { x: i32, y: i32 }
      export fn run(): i32 { let p: P = { x = 1, y = 2 }; return p.x; }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("multi-return frame functions restore the frame and preserve results", () => {
    const { wat } = checkedCompile(`
      struct P { x: i32, y: i32 }
      export fn run(): (i32, i32) {
        let p: P = { x = 1, y = 2 };
        return p.x, p.y;
      }
    `);
    assert.deepEqual(runExport(wat, "run"), [1, 2]);
  });
});

describe("Emission: stdlib global import", () => {
  maybeTest("imported f32 globals retain their runtime value", async () => {
    const result = await runMergedExport(
      `
      import PI from "math"
      export fn run(): f32 { return PI; }
      `,
      "run",
    );
    assert(Math.abs(Number(result) - Math.PI) < 0.000_001);
  });
});

describe("Emission: named function references", () => {
  maybeTest("function references call the original function with their arguments", async () => {
    assert.equal(
      await runMergedExport(
        `
      fn add(a: i32, b: i32): i32 { return a + b; }
      export fn run(): i32 {
        let op: fn(i32,i32):i32 = add;
        return op(1, 2);
      }
        `,
        "run",
      ),
      3,
    );
  });

  maybeTest("multiple function references preserve their distinct targets", async () => {
    assert.equal(
      await runMergedExport(
        `
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn sub(a: i32, b: i32): i32 { return a - b; }
      export fn run(): i32 {
        let second: fn(i32,i32):i32 = sub;
        let first: fn(i32,i32):i32 = add;
        return first(3, 2) + second(3, 2);
      }
        `,
        "run",
      ),
      6,
    );
  });

  maybeTest("void function references remain callable", async () => {
    assert.equal(
      await runMergedExport(
        `
      let touched: i32 = 0;
      fn mark(): void { touched = 7; }
      export fn run(): i32 {
        let cb: fn():void = mark;
        cb();
        return touched;
      }
        `,
        "run",
      ),
      7,
    );
  });

  test("two different functions get distinct slots", () => {
    const { meta } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn sub(a: i32, b: i32): i32 { return a - b; }
      fn outer(): void {
        let op1: fn(i32,i32):i32 = add;
        let op2: fn(i32,i32):i32 = sub;
      }
    `);
    assert(meta.fnTable.has("add") && meta.fnTable.has("sub"));
    const s1 = meta.fnTable.get("add")!.slot;
    const s2 = meta.fnTable.get("sub")!.slot;
    assert.notEqual(s1, s2, "add and sub should have different slots");
  });

  test("same function referenced twice gets one slot (dedup)", () => {
    const { meta } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): void {
        let a: fn(i32,i32):i32 = add;
        let b: fn(i32,i32):i32 = add;
      }
    `);
    assert(meta.fnTable.size === 1, `Expected 1 table entry, got ${meta.fnTable.size}`);
  });
});

describe("Emission: math stdlib calls", () => {
  maybeTest("Tier 1 f32 imports execute through the bundled stdlib", async () => {
    assert.equal(
      await runMergedExport(
        `
      import sqrt, floor, abs_f32 from "math"
      export fn run(): f32 { return floor(sqrt(abs_f32(-4.0))); }
        `,
        "run",
      ),
      2,
    );
  });

  maybeTest("Tier 1 f64 and integer imports execute through the bundled stdlib", async () => {
    assert.equal(
      await runMergedExport(
        `
      import sqrt_f64, abs_i32 from "math"
      export fn run(): i32 { return abs_i32(-3) + (sqrt_f64(9.0 as f64) as i32); }
        `,
        "run",
      ),
      6,
    );
  });

  maybeTest("Tier 2 imports execute through the bundled stdlib", async () => {
    assert.equal(
      await runMergedExport(
        `
      import sin, atan2, pow, fmod from "math"
      export fn run(): f32 {
        return sin(0.0) + atan2(0.0, 1.0) + pow(2.0, 3) + fmod(3.0, 2.0);
      }
        `,
        "run",
      ),
      9,
    );
  });
});
