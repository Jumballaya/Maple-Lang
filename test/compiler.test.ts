import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { compiler, linkStdlibImports, resolveImportModule } from "../src/compiler/compiler";
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
import type { Token } from "../src/lexer/token.types";
import { InfixExpression } from "../src/parser/ast/expressions/InfixExpression";
import { IntegerLiteralExpression } from "../src/parser/ast/expressions/IntegerLiteral";
import { MemberExpression } from "../src/parser/ast/expressions/MemberExpression";
import { StructLiteralExpression } from "../src/parser/ast/expressions/StructLiteralExpression";
import type { ASTExpression } from "../src/parser/ast/types/ast.type";
import { Parser } from "../src/parser/Parser";
import { maybeTest, runExport } from "./helpers";

function compile(src: string) {
  const p = new Parser(src);
  const ast = p.parse("test");
  assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join(", ")}`);
  const meta = extractModuleMeta(ast);
  collectFnReferences(ast, meta);
  linkStdlibImports(meta);
  const mod = emitModule(ast, meta);
  const wat = mod.buildWat();
  return { ast, meta, mod, wat };
}

function checkedCompile(src: string) {
  const parser = new Parser(src, "behavioralization.maple");
  const ast = parser.parse("behavioralization");
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
  const mod = emitModule(ast, meta);
  const wat = mod.buildWat();
  return { ast, meta, mod, wat };
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

function assertContainsInOrder(wat: string, fragments: string[]): void {
  let cursor = 0;
  for (const fragment of fragments) {
    const index = wat.indexOf(fragment, cursor);
    assert(index >= 0, `Expected to find "${fragment}" after index ${cursor}`);
    cursor = index + fragment.length;
  }
}

describe("Emission: Functions", () => {
  test("void function emits func without result", () => {
    const { wat } = compile("fn test(): void {}");
    assert(wat.includes("(func $test"), "Missing function declaration");
    assert(!wat.includes("(result"), "Void function should not emit result");
  });

  test("i32 return emits i32 result and constant", () => {
    const { wat } = compile("fn test(): i32 { return 1; }");
    assert(wat.includes("(result i32)"));
    assert(wat.includes("(i32.const 1)"));
  });

  test("f32 return emits f32 result and constant", () => {
    const { wat } = compile("fn test(): f32 { return 1.5; }");
    assert(wat.includes("(result f32)"));
    assert(wat.includes("(f32.const 1.5)"));
  });

  test("exported function emits export", () => {
    const { wat } = compile("export fn test(): void {}");
    assert(wat.includes('(export "test")'));
  });

  test("function params emit expected wasm params", () => {
    const { wat } = compile("fn add(a: i32, b: i32): i32 { return a + b; }");
    assert(wat.includes("(param $a i32)"));
    assert(wat.includes("(param $b i32)"));
    assert(wat.includes("(local.get $a)"));
    assert(wat.includes("(local.get $b)"));
  });

  test("mixed param types emit expected wasm params", () => {
    const { wat } = compile("fn mixed(a: i32, b: f32): i32 { return a; }");
    assert(wat.includes("(param $a i32)"));
    assert(wat.includes("(param $b f32)"));
  });

  test("function call emits call instruction", () => {
    const { wat } = compile("fn callee(): i32 { return 1; } fn caller(): i32 { return callee(); }");
    assert(/\(call \$callee\s*\)/.test(wat));
  });

  test("function call with arguments emits args before call", () => {
    const { wat } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn caller(): i32 { return add(3, 4); }
    `);
    assert(wat.includes("(i32.const 3)"));
    assert(wat.includes("(i32.const 4)"));
    assert(wat.includes("(call $add"));
  });

  test("param count is not duplicated", () => {
    const { wat } = compile("export fn quad(a: i32, b: i32, c: f32, d: i32): i32 { return a; }");
    const params = wat.match(/\(param \$/g);
    assert(params !== null);
    assert.equal(params.length, 4);
  });
});

describe("Emission: Variables", () => {
  test("local i32 let emits local and local.set", () => {
    const { wat } = compile("fn test(): void { let x: i32 = 5; }");
    assert(wat.includes("(local $x i32)"));
    assert(wat.includes("(local.set $x (i32.const 5))"));
  });

  test("local f32 let emits local and local.set", () => {
    const { wat } = compile("fn test(): void { let x: f32 = 3.14; }");
    assert(wat.includes("(local $x f32)"));
    assert(wat.includes("(local.set $x (f32.const 3.14))"));
  });

  test("local bool let emits i32 local and i32 const", () => {
    const { wat } = compile("fn test(): void { let x: bool = true; }");
    assert(wat.includes("(local $x i32)"));
    assert(wat.includes("(local.set $x (i32.const 1))"));
  });

  test("global f32 let emits mutable f32 global", () => {
    const { wat } = compile("let rate: f32 = 1.5;");
    assert(wat.includes("(global $rate (mut f32) (f32.const 1.5))"));
  });

  test("global i32 let emits mutable global", () => {
    const { wat } = compile("let x: i32 = 5;");
    assert(wat.includes("(global $x (mut i32) (i32.const 5))"));
  });

  test("i32 assignment emits local.set with i32 value", () => {
    const { wat } = compile("fn test(): void { let x: i32 = 0; x = 10; }");
    assert(wat.includes("(local.set $x (i32.const 10))"));
  });

  test("f32 assignment emits local.set with f32 value", () => {
    const { wat } = compile("fn test(): void { let x: f32 = 0.0; x = 2.5; }");
    assert(wat.includes("(local.set $x (f32.const 2.5))"));
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

  test("struct let with mixed i32 and f32 members emits store instructions", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: f32 }
      fn test(): void {
        let p: Point = { x = 10, y = 3.14 };
      }
    `);
    assert(wat.includes("i32.store"), `Missing i32.store for x:\n${wat}`);
    assert(wat.includes("f32.store"), `Missing f32.store for y:\n${wat}`);
    assert(!wat.includes("$p_x"), `Must not contain flat $p_x:\n${wat}`);
    assert(!wat.includes("$p_y"), `Must not contain flat $p_y:\n${wat}`);
  });

  test("struct let with only f32 members emits f32.store instructions", () => {
    const { wat } = compile(`
      struct Vec2 { x: f32, y: f32 }
      fn test(): void {
        let v: Vec2 = { x = 1.5, y = 2.5 };
      }
    `);
    const f32Stores = (wat.match(/f32\.store/g) || []).length;
    assert(f32Stores >= 2, `Expected at least 2 f32.store, got ${f32Stores}:\n${wat}`);
    assert(!wat.includes("$v_x"), `Must not contain flat $v_x:\n${wat}`);
    assert(!wat.includes("$v_y"), `Must not contain flat $v_y:\n${wat}`);
  });

  test("struct i32 member used in binary arithmetic emits i32.add and i32.load", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 {
        let p: Point = { x = 3, y = 4 };
        return p.x + p.y;
      }
    `);
    assert(wat.includes("i32.add"), `Missing i32.add:\n${wat}`);
    const loadCount = (wat.match(/i32\.load/g) || []).length;
    assert(loadCount >= 2, `Expected at least 2 i32.load for p.x + p.y, got ${loadCount}:\n${wat}`);
    assert(!wat.includes("local.get $p_x"), `Must not use flat local $p_x:\n${wat}`);
    assert(!wat.includes("local.get $p_y"), `Must not use flat local $p_y:\n${wat}`);
  });

  test("struct member used in comparison emits comparison opcode and i32.load", () => {
    const { wat } = compile(`
      struct Counter { n: i32 }
      fn test(): i32 {
        let c: Counter = { n = 5 };
        if (c.n > 0) {
          return 1;
        }
        return 0;
      }
    `);
    assert(wat.includes("i32.gt_s"), `Missing i32.gt_s:\n${wat}`);
    assert(wat.includes("i32.load"), `Missing i32.load for c.n:\n${wat}`);
    assert(!wat.includes("local.get $c_n"), `Must not use flat local $c_n:\n${wat}`);
  });

  test("struct f32 member used in binary arithmetic emits f32.add and f32.load", () => {
    const { wat } = compile(`
      struct Vec2 { x: f32, y: f32 }
      fn test(): f32 {
        let v: Vec2 = { x = 1.5, y = 2.5 };
        return v.x + v.y;
      }
    `);
    assert(wat.includes("f32.add"), `Missing f32.add:\n${wat}`);
    const loadCount = (wat.match(/f32\.load/g) || []).length;
    assert(loadCount >= 2, `Expected at least 2 f32.load for v.x + v.y, got ${loadCount}:\n${wat}`);
    assert(!wat.includes("local.get $v_x"), `Must not use flat local $v_x:\n${wat}`);
    assert(!wat.includes("local.get $v_y"), `Must not use flat local $v_y:\n${wat}`);
  });

  test("struct member as direct while-loop condition emits loop with i32.load", () => {
    const { wat } = compile(`
      struct Flag { active: i32 }
      fn test(): void {
        let f: Flag = { active = 1 };
        while (f.active) {
          f.active = 0;
        }
      }
    `);
    assert(wat.includes("(loop"), `Missing loop:\n${wat}`);
    assert(wat.includes("i32.load"), `Missing i32.load for f.active:\n${wat}`);
    assert(!wat.includes("local.get $f_active"), `Must not use flat local $f_active:\n${wat}`);
  });

  test("prefix minus on struct member emits negation with i32.load", () => {
    const { wat } = compile(`
      struct Num { val: i32 }
      fn test(): i32 {
        let n: Num = { val = 7 };
        return -n.val;
      }
    `);
    assert(wat.includes("i32.sub"), `Missing i32.sub for negation:\n${wat}`);
    assert(wat.includes("i32.load"), `Missing i32.load for n.val:\n${wat}`);
    assert(!wat.includes("local.get $n_val"), `Must not use flat local $n_val:\n${wat}`);
  });

  test("memory-backed struct param member used in binary arithmetic resolves type correctly", () => {
    // struct params are passed as i32 memory pointers; members read via i32.load + offset
    const { wat } = compile(`
      struct Pair { a: i32, b: i32 }
      fn test(p: Pair): i32 {
        return p.a + p.b;
      }
    `);
    assert(wat.includes("i32.add"));
    assert(wat.includes("i32.load"));
    assert(wat.includes("local.get $p"));
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
  test("member access with identifier parent compiles", () => {
    const { wat } = compile(`
      struct S { a: i32, b: i32 }
      let s: S = { a = 1, b = 2 };
      fn test(): i32 { return s.a; }
    `);
    assert(wat.includes("(func $test (result i32)"));
    assert(wat.includes("(i32.load (i32.add (global.get $s) (i32.const 0)))"));
  });

  test("member access on a function-call base compiles", () => {
    const { wat } = compile(`
      struct P { x: i32 }
      fn make(): P { let p: P = { x = 42 }; return p; }
      fn test(): i32 { return make().x; }
    `);
    assert(wat.includes("(call $make"));
    assert(wat.includes("(i32.load"));
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

  test("member assignment on local struct emits i32.store", () => {
    const { wat } = compile(`
      struct Thing { a: i32 }
      fn test(): void {
        let t: Thing = { a = 1 };
        t.a = 14;
      }
    `);
    assert(wat.includes("i32.store"), `Missing i32.store for t.a = 14:\n${wat}`);
    assert(wat.includes("(i32.const 14)"), `Missing value 14:\n${wat}`);
    assert(!wat.includes("$t_a"), `Must not contain flat $t_a:\n${wat}`);
    assert(!wat.includes("local.set $t_a"), `Must not use local.set $t_a:\n${wat}`);
  });
});

describe("Emission: Index Access", () => {
  test("literal index emits direct load for zero index", () => {
    const { wat } = compile("fn test(): i32 { let arr: i32[] = [1, 2, 3]; return arr[0]; }");
    assert(wat.includes("i32.load"));
  });

  test("variable index emits computed offset load", () => {
    const { wat } = compile(
      "fn test(): i32 { let arr: i32[] = [1, 2, 3]; let x: i32 = 1; return arr[x]; }",
    );
    assert(wat.includes("i32.mul"));
    assert(wat.includes("i32.add"));
  });

  test("expression index emits computed offset load", () => {
    const { wat } = compile(
      "fn test(): i32 { let arr: i32[] = [1, 2, 3]; let x: i32 = 1; return arr[x + 1]; }",
    );
    assert(wat.includes("i32.add"));
    assert(wat.includes("i32.load"));
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
  test("arr[literal] = val emits i32.store with const offset", () => {
    const { wat } = compile(`
      fn test(): void {
        let arr: i32[] = [1, 2, 3];
        arr[0] = 99;
      }
    `);
    assert(wat.includes("i32.store"));
    assert(wat.includes("(i32.const 99)"));
  });

  test("arr[var] = val emits i32.store with computed offset", () => {
    const { wat } = compile(`
      fn test(): void {
        let arr: i32[] = [1, 2, 3];
        let i: i32 = 1;
        arr[i] = 42;
      }
    `);
    assert(wat.includes("i32.store"));
    assert(wat.includes("i32.mul"));
    assert(wat.includes("(i32.const 42)"));
  });
});

describe("Emission: array literal defense", () => {
  test("expression elements throw instead of silently encoding zero", () => {
    assert.throws(
      () => compile("fn f(): void { let x: i32 = 1; let a: i32[] = [x]; }"),
      /array literal element must be a literal/,
    );
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

  test("emitted wat is wrapped in module", () => {
    const { wat } = compile("fn test(): void {}");
    assert(wat.startsWith("(module"));
    assert(wat.endsWith(")"));
  });

  test("emitted wat owns and exports memory by default", () => {
    const { wat } = compile("fn test(): void {}");
    assert(wat.includes('(memory (export "memory") 2)'));
    assert(!wat.includes('(import "runtime" "memory"'));
  });

  test("emitModule can request an imported memory", () => {
    const p = new Parser("fn test(): void {}");
    const ast = p.parse("test");
    const meta = extractModuleMeta(ast);
    const wat = emitModule(ast, meta, { importMemory: true }).buildWat();
    assert(wat.includes('(import "runtime" "memory" (memory 2))'));
    assert(!wat.includes('(memory (export "memory")'));
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
  test("explicit string local emits i32 local and string pointer set", () => {
    const { wat } = compile('fn f(): void { let s: string = "hello"; }');
    assert(wat.includes("(local $s i32)"), `Missing (local $s i32) in:\n${wat}`);
    assert(wat.includes("(local.set $s (i32.const"), `Missing string pointer set in:\n${wat}`);
    assert(wat.includes("(data (offset (i32.const"), `Missing data segment in:\n${wat}`);
  });

  test("inferred string local emits i32 local and string pointer set", () => {
    const { wat } = compile('fn f(): void { let s = "world"; }');
    assert(wat.includes("(local $s i32)"), `Missing (local $s i32) in:\n${wat}`);
    assert(wat.includes("(local.set $s (i32.const"), `Missing string pointer set in:\n${wat}`);
    assert(wat.includes("(data (offset (i32.const"), `Missing data segment in:\n${wat}`);
  });

  test("string .len member access emits load from string header", () => {
    const { wat } = compile('fn f(): i32 { let s: string = "hello"; return s.len; }');
    assert(wat.includes("i32.load"), `Missing i32.load for s.len in:\n${wat}`);
  });
});

describe("Emission: Struct methods", () => {
  test("dotted method declaration emits mangled wasm function name", () => {
    const { wat } = compile(`
      struct Vec2 { x: i32, y: i32, }
      fn Vec2.add(v)(other: Vec2): i32 { return v.x + other.x; }
    `);
    assert(wat.includes("(func $Vec2_add"), `Missing mangled function name in:\n${wat}`);
    assert(wat.includes("(param $v i32)"), `Missing receiver param in:\n${wat}`);
    assert(wat.includes("(param $other i32)"), `Missing method arg param in:\n${wat}`);
    assert(wat.includes("(result i32)"), `Missing method return type in:\n${wat}`);
  });

  test("method call emits mangled call with receiver as first argument", () => {
    const { wat } = compile(`
      struct Vec2 { x: i32, y: i32, }
      fn Vec2.add(v)(other: Vec2): i32 { return v.x + other.x; }
      fn run(v: Vec2, other: Vec2): i32 { return v.add(other); }
    `);
    assert(wat.includes("(call $Vec2_add"), `Missing mangled method call in:\n${wat}`);
    assert(wat.includes("(local.get $v)"), `Missing receiver argument in:\n${wat}`);
    assert(wat.includes("(local.get $other)"), `Missing method argument in:\n${wat}`);
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
  test("any module emits $__sp global", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 1, y = 2 }; }
    `);
    assert(
      wat.includes("(global $__sp (mut i32) (i32.const 65536))"),
      `Missing $__sp global:\n${wat}`,
    );
  });

  test("module with no local structs does not emit $__sp", () => {
    const { wat } = compile("fn test(): i32 { return 1; }");
    assert(!wat.includes("$__sp"), `Unexpected $__sp in struct-free module:\n${wat}`);
  });

  test("$__sp appears before any function in WAT", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 1, y = 2 }; }
    `);
    const spIdx = wat.indexOf("$__sp");
    const funcIdx = wat.indexOf("(func");
    assert(spIdx !== -1, `Missing $__sp:\n${wat}`);
    assert(spIdx < funcIdx, `$__sp must appear before (func:\n${wat}`);
  });
});

describe("Emission: Local declaration — flat locals gone", () => {
  test("local struct does NOT produce flattened $p_x / $p_y locals", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 2, y = 3 }; }
    `);
    assert(!wat.includes("$p_x"), `Must not contain $p_x:\n${wat}`);
    assert(!wat.includes("$p_y"), `Must not contain $p_y:\n${wat}`);
  });

  test("local struct emits single (local $p i32) pointer", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 2, y = 3 }; }
    `);
    assert(wat.includes("(local $p i32)"), `Missing (local $p i32):\n${wat}`);
  });
});

describe("Emission: Field init — stores to memory", () => {
  test("i32 field x at offset 0 emits i32.store", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 2, y = 3 }; }
    `);
    assert(
      wat.includes("(i32.store (i32.add (local.get $p) (i32.const 0)) (i32.const 2))"),
      `Missing x store:\n${wat}`,
    );
  });

  test("i32 field y at offset 4 emits i32.store", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 2, y = 3 }; }
    `);
    assert(
      wat.includes("(i32.store (i32.add (local.get $p) (i32.const 4)) (i32.const 3))"),
      `Missing y store:\n${wat}`,
    );
  });

  test("mixed i32/f32 struct emits correct store ops per field", () => {
    const { wat } = compile(`
      struct Mixed { a: i32, b: f32 }
      fn test(): void { let m: Mixed = { a = 1, b = 3.14 }; }
    `);
    assert(wat.includes("i32.store"), `Missing i32.store for field a:\n${wat}`);
    assert(wat.includes("f32.store"), `Missing f32.store for field b:\n${wat}`);
  });

  test("f32-only struct emits f32.store for both fields", () => {
    const { wat } = compile(`
      struct Vec2 { x: f32, y: f32 }
      fn test(): void { let v: Vec2 = { x = 1.5, y = 2.5 }; }
    `);
    assert(!wat.includes("$v_x"), `Must not contain $v_x:\n${wat}`);
    assert(!wat.includes("$v_y"), `Must not contain $v_y:\n${wat}`);
    const f32Stores = (wat.match(/f32\.store/g) || []).length;
    assert(f32Stores >= 2, `Expected at least 2 f32.store instructions, got ${f32Stores}:\n${wat}`);
  });

  test("single-field struct emits one i32.store", () => {
    const { wat } = compile(`
      struct Single { val: i32 }
      fn test(): void { let s: Single = { val = 42 }; }
    `);
    assert(wat.includes("(i32.store"), `Missing i32.store:\n${wat}`);
    assert(wat.includes("(i32.const 42)"), `Missing value 42:\n${wat}`);
  });

  test("expression field values emit full expressions as store values", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(a: i32, b: i32): void { let p: Point = { x = a + 1, y = b * 2 }; }
    `);
    assert(wat.includes("i32.add"), `Missing i32.add for x = a + 1:\n${wat}`);
    assert(wat.includes("i32.mul"), `Missing i32.mul for y = b * 2:\n${wat}`);
    assert(wat.includes("i32.store"), `Missing i32.store:\n${wat}`);
  });
});

describe("Emission: Member read — loads from memory", () => {
  test("p.x emits i32.load at offset 0", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 { let p: Point = { x = 3, y = 4 }; return p.x; }
    `);
    assert(
      wat.includes("(i32.load (i32.add (local.get $p) (i32.const 0)))"),
      `Missing i32.load for p.x:\n${wat}`,
    );
    assert(!wat.includes("local.get $p_x"), `Must not use flat local $p_x:\n${wat}`);
  });

  test("p.y emits i32.load at offset 4", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 { let p: Point = { x = 3, y = 4 }; return p.y; }
    `);
    assert(
      wat.includes("(i32.load (i32.add (local.get $p) (i32.const 4)))"),
      `Missing i32.load for p.y:\n${wat}`,
    );
  });

  test("f32 member emits f32.load", () => {
    const { wat } = compile(`
      struct Vec2 { x: f32, y: f32 }
      fn test(): f32 { let v: Vec2 = { x = 1.5, y = 2.5 }; return v.x; }
    `);
    assert(wat.includes("f32.load"), `Missing f32.load for v.x:\n${wat}`);
  });

  test("p.x + p.y emits i32.add with two i32.load sub-expressions", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 { let p: Point = { x = 3, y = 4 }; return p.x + p.y; }
    `);
    assert(wat.includes("i32.add"), `Missing i32.add:\n${wat}`);
    const loadCount = (wat.match(/i32\.load/g) || []).length;
    assert(loadCount >= 2, `Expected at least 2 i32.load for p.x + p.y, got ${loadCount}:\n${wat}`);
    assert(!wat.includes("local.get $p_x"), `Must not use flat local:\n${wat}`);
    assert(!wat.includes("local.get $p_y"), `Must not use flat local:\n${wat}`);
  });

  test("p.x > 0 emits i32.gt_s with i32.load as left operand", () => {
    const { wat } = compile(`
      struct Counter { n: i32 }
      fn test(): i32 { let c: Counter = { n = 5 }; if (c.n > 0) { return 1; } return 0; }
    `);
    assert(wat.includes("i32.gt_s"), `Missing i32.gt_s:\n${wat}`);
    assert(wat.includes("i32.load"), `Missing i32.load for c.n:\n${wat}`);
    assert(!wat.includes("local.get $c_n"), `Must not use flat local:\n${wat}`);
  });

  test("prefix negation on struct member emits i32.sub with i32.load", () => {
    const { wat } = compile(`
      struct Num { val: i32 }
      fn test(): i32 { let n: Num = { val = 7 }; return -n.val; }
    `);
    assert(wat.includes("i32.sub"), `Missing i32.sub for negation:\n${wat}`);
    assert(wat.includes("i32.load"), `Missing i32.load for n.val:\n${wat}`);
    assert(!wat.includes("local.get $n_val"), `Must not use flat local:\n${wat}`);
  });

  test("struct member as while-loop condition emits i32.load", () => {
    const { wat } = compile(`
      struct Flag { active: i32 }
      fn test(): void {
        let f: Flag = { active = 1 };
        while (f.active) { f.active = 0; }
      }
    `);
    assert(wat.includes("(loop"), `Missing loop:\n${wat}`);
    assert(wat.includes("i32.load"), `Missing i32.load for f.active:\n${wat}`);
    assert(!wat.includes("local.get $f_active"), `Must not use flat local:\n${wat}`);
  });

  test("struct member as for-loop condition emits i32.load", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void {
        let p: Point = { x = 5, y = 0 };
        for (let i: i32 = 0; p.x > 0; i = i + 1) { p.x = p.x - 1; }
      }
    `);
    assert(wat.includes("i32.load"), `Missing i32.load for p.x in for condition:\n${wat}`);
  });

  test("struct member as if condition emits i32.load", () => {
    const { wat } = compile(`
      struct Counter { n: i32 }
      fn test(): i32 { let c: Counter = { n = 5 }; if (c.n) { return 1; } return 0; }
    `);
    assert(wat.includes("i32.load"), `Missing i32.load for c.n in if condition:\n${wat}`);
    assert(!wat.includes("local.get $c_n"), `Must not use flat local:\n${wat}`);
  });

  test("struct member as function argument emits i32.load", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn bar(n: i32): i32 { return n; }
      fn test(): i32 { let p: Point = { x = 7, y = 0 }; return bar(p.x); }
    `);
    assert(wat.includes("(call $bar"), `Missing call $bar:\n${wat}`);
    assert(wat.includes("i32.load"), `Missing i32.load for p.x as argument:\n${wat}`);
  });
});

describe("Emission: Member write — stores to memory", () => {
  test("p.x = 10 emits i32.store at offset 0", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 0, y = 0 }; p.x = 10; }
    `);
    assert(
      wat.includes("(i32.store (i32.add (local.get $p) (i32.const 0)) (i32.const 10))"),
      `Missing i32.store for p.x = 10:\n${wat}`,
    );
  });

  test("p.y = 20 emits i32.store at offset 4", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 0, y = 0 }; p.y = 20; }
    `);
    assert(
      wat.includes("(i32.store (i32.add (local.get $p) (i32.const 4)) (i32.const 20))"),
      `Missing i32.store for p.y = 20:\n${wat}`,
    );
  });

  test("write-then-read round-trip emits i32.store then i32.load at same offset", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 { let p: Point = { x = 0, y = 0 }; p.x = 99; return p.x; }
    `);
    assert(wat.includes("i32.store"), `Missing i32.store:\n${wat}`);
    assert(wat.includes("i32.load"), `Missing i32.load:\n${wat}`);
  });
});

describe("Emission: Prologue / epilogue", () => {
  test("function with one Point local emits SP prologue", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 1, y = 2 }; }
    `);
    assert(
      wat.includes("(global.set $__sp (i32.sub (global.get $__sp) (i32.const 8)))"),
      `Missing SP prologue:\n${wat}`,
    );
  });

  test("function with one Point local emits SP epilogue", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 1, y = 2 }; }
    `);
    assert(
      wat.includes("(global.set $__sp (i32.add (global.get $__sp) (i32.const 8)))"),
      `Missing SP epilogue:\n${wat}`,
    );
  });

  test("prologue appears before stores, epilogue after body", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 1, y = 2 }; }
    `);
    const prologueIdx = wat.indexOf("i32.sub (global.get $__sp)");
    const storeIdx = wat.indexOf("i32.store");
    const epilogueIdx = wat.indexOf("i32.add (global.get $__sp)");
    assert(prologueIdx < storeIdx, `Prologue must appear before stores:\n${wat}`);
    assert(storeIdx < epilogueIdx, `Epilogue must appear after stores:\n${wat}`);
  });

  test("two Point locals emit frame size 16", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void {
        let p: Point = { x = 1, y = 2 };
        let q: Point = { x = 3, y = 4 };
      }
    `);
    assert(wat.includes("(i32.const 16)"), `Expected frame size 16 for two Points:\n${wat}`);
  });

  test("Big struct (size=16) emits correct frame size", () => {
    const { wat } = compile(`
      struct Big { a: i32, b: i32, c: i32, d: i32 }
      fn test(): void { let b: Big = { a = 1, b = 2, c = 3, d = 4 }; }
    `);
    assert(
      wat.includes("(i32.sub (global.get $__sp) (i32.const 16))"),
      `Expected frame size 16 for Big struct:\n${wat}`,
    );
  });

  test("function with no local structs does NOT emit SP adjustments", () => {
    const { wat } = compile("fn test(): i32 { let x: i32 = 5; return x; }");
    const funcStart = wat.indexOf("(func $test");
    const funcBody = wat.slice(funcStart);
    assert(
      !funcBody.includes("global.set $__sp"),
      `Function without structs must not adjust SP:\n${wat}`,
    );
    assert(
      !funcBody.includes("global.get $__sp"),
      `Function without structs must not read SP:\n${wat}`,
    );
  });

  test("function with no local structs does NOT emit $__ret_tmp", () => {
    const { wat } = compile("fn test(): i32 { return 42; }");
    assert(!wat.includes("__ret_tmp"), `Must not contain __ret_tmp:\n${wat}`);
  });
});

describe("Emission: Pointer initialization", () => {
  test("first struct at offset 0 uses direct global.get", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 1, y = 2 }; }
    `);
    assert(
      wat.includes("(local.set $p (global.get $__sp))"),
      `Missing pointer init for first struct:\n${wat}`,
    );
  });

  test("second struct at offset 8 uses i32.add", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void {
        let p: Point = { x = 1, y = 2 };
        let q: Point = { x = 3, y = 4 };
      }
    `);
    assert(
      wat.includes("(local.set $q (i32.add (global.get $__sp) (i32.const 8)))"),
      `Missing pointer init for second struct:\n${wat}`,
    );
  });

  test("pointer inits appear between prologue and body", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 1, y = 2 }; }
    `);
    const prologueIdx = wat.indexOf("i32.sub (global.get $__sp)");
    const ptrInitIdx = wat.indexOf("(local.set $p (global.get $__sp))");
    const storeIdx = wat.indexOf("i32.store");
    assert(prologueIdx < ptrInitIdx, `Pointer init must appear after prologue:\n${wat}`);
    assert(ptrInitIdx < storeIdx, `Pointer init must appear before field stores:\n${wat}`);
  });
});

describe("Emission: Return with SP restore via $__ret_tmp", () => {
  test("value-returning return with local struct uses $__ret_tmp", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 { let p: Point = { x = 3, y = 4 }; return p.x; }
    `);
    assert(wat.includes("local.set $__ret_tmp"), `Missing local.set $__ret_tmp:\n${wat}`);
    assert(wat.includes("local.get $__ret_tmp"), `Missing local.get $__ret_tmp:\n${wat}`);
  });

  test("void return with local struct emits SP restore then (return)", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 1, y = 2 }; return; }
    `);
    assert(
      wat.includes("(global.set $__sp (i32.add"),
      `Missing SP restore before void return:\n${wat}`,
    );
    assert(wat.includes("(return)"), `Missing (return):\n${wat}`);
    assert(!wat.includes("__ret_tmp"), `Void return must not use __ret_tmp:\n${wat}`);
  });

  test("return 42 from function with local struct still uses $__ret_tmp", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 { let p: Point = { x = 1, y = 2 }; return 42; }
    `);
    assert(
      wat.includes("local.set $__ret_tmp"),
      `Missing $__ret_tmp even for non-struct return:\n${wat}`,
    );
  });

  test("multiple return paths both use $__ret_tmp", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(cond: i32): i32 {
        let p: Point = { x = 3, y = 4 };
        if (cond > 0) { return p.x; }
        return p.y;
      }
    `);
    const retTmpSets = (wat.match(/local\.set \$__ret_tmp/g) || []).length;
    assert(
      retTmpSets >= 2,
      `Expected at least 2 local.set $__ret_tmp for two return paths, got ${retTmpSets}:\n${wat}`,
    );
  });

  test("f32-returning function with local struct declares f32 $__ret_tmp", () => {
    const { wat } = compile(`
      struct Vec2 { x: f32, y: f32 }
      fn test(): f32 { let v: Vec2 = { x = 1.5, y = 2.5 }; return v.x; }
    `);
    assert(wat.includes("(local $__ret_tmp f32)"), `Missing (local $__ret_tmp f32):\n${wat}`);
  });

  test("void function with local struct has no $__ret_tmp", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void { let p: Point = { x = 1, y = 2 }; }
    `);
    assert(!wat.includes("__ret_tmp"), `Void function must not declare $__ret_tmp:\n${wat}`);
  });

  test("void function with local struct and value return does not reference $__ret_tmp", () => {
    // Emitter robustness path: type checker would reject this program, but
    // emitter-only compile should not emit undeclared $__ret_tmp references.
    const { wat } = compile(`
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
});

describe("Emission: Negative assertions — flat locals gone", () => {
  test("I41-43: no $p_x, $p_y, local.set $p_x, local.get $p_x in WAT", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 {
        let p: Point = { x = 3, y = 4 };
        p.x = 10;
        return p.x + p.y;
      }
    `);
    assert(!wat.includes("$p_x"), `Must not contain $p_x:\n${wat}`);
    assert(!wat.includes("$p_y"), `Must not contain $p_y:\n${wat}`);
  });

  test("break/continue in loop with local struct do NOT emit SP restore", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void {
        let p: Point = { x = 5, y = 0 };
        while (p.x > 0) {
          p.x = p.x - 1;
          if (p.x == 2) { continue; }
          if (p.x == 1) { break; }
        }
      }
    `);
    const brBreak = wat.indexOf("(br $break_");
    const brLoop = wat.indexOf("(br $loop_");
    assert(brBreak !== -1, `Expected break instruction:\n${wat}`);
    assert(brLoop !== -1, `Expected continue instruction:\n${wat}`);
    const beforeBreak = wat.slice(Math.max(0, brBreak - 120), brBreak);
    const beforeContinue = wat.slice(Math.max(0, brLoop - 120), brLoop);
    assert(
      !beforeBreak.includes("global.set $__sp"),
      `SP must not be restored before break:\n${wat}`,
    );
    assert(
      !beforeContinue.includes("global.set $__sp"),
      `SP must not be restored before continue:\n${wat}`,
    );
  });
});

describe("Emission: Global struct regression", () => {
  test("global struct still emits data segment", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      let g: Point = { x = 2, y = 3 };
    `);
    assert(wat.includes("(data (offset"), `Global struct must have data segment:\n${wat}`);
  });

  test("global struct emits (global $g (mut i32) ...) with address", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      let g: Point = { x = 2, y = 3 };
    `);
    assert(wat.includes("(global $g (mut i32) (i32.const"), `Missing global with address:\n${wat}`);
  });

  test("global struct member read uses global.get", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      let g: Point = { x = 2, y = 3 };
      fn test(): i32 { return g.x; }
    `);
    assert(
      wat.includes("(i32.load (i32.add (global.get $g) (i32.const 0)))"),
      `Missing global member load:\n${wat}`,
    );
  });

  test("global struct member write uses global.get", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      let g: Point = { x = 2, y = 3 };
      fn test(): void { g.x = 5; }
    `);
    assert(wat.includes("i32.store"), `Missing i32.store for global write:\n${wat}`);
    assert(wat.includes("global.get $g"), `Must use global.get for global struct:\n${wat}`);
  });
});

describe("Emission: Param struct regression", () => {
  test("struct param still uses (param $p i32) and i32.load + offset", () => {
    const { wat } = compile(`
      struct Pair { a: i32, b: i32 }
      fn test(p: Pair): i32 { return p.a + p.b; }
    `);
    assert(wat.includes("(param $p i32)"), `Missing (param $p i32):\n${wat}`);
    assert(wat.includes("i32.load"), `Missing i32.load for param member:\n${wat}`);
    assert(wat.includes("local.get $p"), `Missing local.get $p:\n${wat}`);
  });

  test("param struct member type resolves correctly (i32.add not f32.add)", () => {
    const { wat } = compile(`
      struct Pair { a: i32, b: i32 }
      fn test(p: Pair): i32 { return p.a + p.b; }
    `);
    assert(wat.includes("i32.add"), `Expected i32.add:\n${wat}`);
    assert(!wat.includes("f32.add"), `Must not use f32.add for i32 members:\n${wat}`);
  });
});

describe("Emission: Method calls on local structs", () => {
  test("method call on local struct emits (call $Point_sum (local.get $p))", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn Point.sum(p)(): i32 { return p.x + p.y; }
      fn test(): i32 { let p: Point = { x = 3, y = 4 }; return p.sum(); }
    `);
    assert(wat.includes("(call $Point_sum"), `Missing method call:\n${wat}`);
    assert(wat.includes("(local.get $p)"), `Missing receiver local.get $p:\n${wat}`);
  });

  test("method call WAT does NOT contain flat $p_x / $p_y", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn Point.sum(p)(): i32 { return p.x + p.y; }
      fn test(): i32 { let p: Point = { x = 3, y = 4 }; return p.sum(); }
    `);
    assert(!wat.includes("$p_x"), `Must not contain $p_x:\n${wat}`);
    assert(!wat.includes("$p_y"), `Must not contain $p_y:\n${wat}`);
  });

  test("method with extra arg on two local structs emits both pointers", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn Point.add(self)(other: Point): i32 { return self.x + other.x; }
      fn test(): i32 {
        let a: Point = { x = 1, y = 2 };
        let b: Point = { x = 3, y = 4 };
        return a.add(b);
      }
    `);
    assert(wat.includes("(call $Point_add"), `Missing method call:\n${wat}`);
    assert(wat.includes("(local.get $a)"), `Missing receiver local.get $a:\n${wat}`);
    assert(wat.includes("(local.get $b)"), `Missing arg local.get $b:\n${wat}`);
  });
});

describe("Emission: Struct member in various expressions", () => {
  test("struct member as switch expression emits i32.load", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 {
        let p: Point = { x = 1, y = 0 };
        switch (p.x) {
          case 0: { return 0; }
          case 1: { return 1; }
          default: { return 2; }
        }
        return 0;
      }
    `);
    assert(wat.includes("i32.load"), `Missing i32.load in switch expression:\n${wat}`);
  });

  test("struct member in binary chain emits multiple i32.load", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 { let p: Point = { x = 2, y = 3 }; return p.x * p.y + p.x; }
    `);
    const loadCount = (wat.match(/i32\.load/g) || []).length;
    assert(
      loadCount >= 3,
      `Expected at least 3 i32.load for p.x * p.y + p.x, got ${loadCount}:\n${wat}`,
    );
  });

  test("struct member in cast emits i32.load + f32.convert_i32_s", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): f32 { let p: Point = { x = 5, y = 0 }; return p.x as f32; }
    `);
    assert(wat.includes("i32.load"), `Missing i32.load:\n${wat}`);
    assert(wat.includes("f32.convert_i32_s"), `Missing f32.convert_i32_s:\n${wat}`);
  });

  test("struct member read into scalar local works", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 {
        let p: Point = { x = 7, y = 0 };
        let total: i32 = p.x;
        total++;
        return total;
      }
    `);
    assert(wat.includes("i32.load"), `Missing i32.load for p.x:\n${wat}`);
    assert(wat.includes("(local.set $total"), `Missing local.set $total:\n${wat}`);
  });
});

describe("Emission: Struct in control flow bodies", () => {
  test("local struct inside if-then block gets frame slot", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(cond: i32): i32 {
        if (cond > 0) {
          let p: Point = { x = 1, y = 2 };
          return p.x;
        }
        return 0;
      }
    `);
    assert(
      wat.includes("global.set $__sp"),
      `Missing SP adjustment for struct in if block:\n${wat}`,
    );
    assert(wat.includes("i32.store"), `Missing i32.store for struct init in if block:\n${wat}`);
  });

  test("local struct inside while body gets frame slot", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 {
        let i: i32 = 0;
        while (i < 1) {
          let p: Point = { x = 5, y = 6 };
          i = i + 1;
        }
        return 0;
      }
    `);
    assert(wat.includes("global.set $__sp"), `Missing SP adjustment:\n${wat}`);
  });

  test("struct field write inside loop uses store/load", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 {
        let p: Point = { x = 5, y = 0 };
        while (p.x > 0) {
          p.x = p.x - 1;
          p.y = p.y + 1;
        }
        return p.y;
      }
    `);
    assert(wat.includes("i32.store"), `Missing i32.store for field write in loop:\n${wat}`);
    assert(wat.includes("i32.load"), `Missing i32.load for field read in loop:\n${wat}`);
  });
});

describe("Emission: extractGlobalData — local struct skipped", () => {
  test("function with local struct literal compiles without error", () => {
    assert.doesNotThrow(() => {
      compile(`
        struct Point { x: i32, y: i32 }
        fn test(): i32 { let p: Point = { x = 3, y = 4 }; return p.x; }
      `);
    });
  });

  test("local struct literal does NOT appear in data segment", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 { let p: Point = { x = 3, y = 4 }; return p.x; }
    `);
    const dataSegments = (wat.match(/\(data \(offset/g) || []).length;
    assert.equal(
      dataSegments,
      0,
      `Local struct must not produce data segment entries, found ${dataSegments}:\n${wat}`,
    );
  });
});

describe("Emission: global struct expression initializers", () => {
  test("global expression field emits init guard and i32.store", () => {
    const { wat } = compile(`
      let offset: i32 = 9;
      struct Point { x: i32, y: i32 }
      let g: Point = { x = offset, y = 0 };
      export fn run(): i32 { return g.x; }
    `);
    assert(
      wat.includes("(global $__globals_inited (mut i32) (i32.const 0))"),
      `Missing $__globals_inited global:\n${wat}`,
    );
    assert(
      wat.includes("(if (i32.eqz (global.get $__globals_inited)) (then"),
      `Missing init guard if-block:\n${wat}`,
    );
    assert(wat.includes("i32.store"), `Missing i32.store in init block:\n${wat}`);
    assert(wat.includes("global.get $offset"), `Missing global source for init store:\n${wat}`);
  });

  test("init guard emits in exported function only", () => {
    const { wat } = compile(`
      let offset: i32 = 9;
      struct Point { x: i32, y: i32 }
      let g: Point = { x = offset, y = 0 };
      fn helper(): i32 { return g.x; }
      export fn run(): i32 { return helper(); }
    `);
    const helperStart = wat.indexOf("(func $helper");
    const runStart = wat.indexOf("(func $run");
    const guard = "(if (i32.eqz (global.get $__globals_inited)) (then";
    const helperBody = wat.slice(helperStart, runStart);
    const runBody = wat.slice(runStart);
    assert(!helperBody.includes(guard), `Non-exported helper must not include init guard:\n${wat}`);
    assert(runBody.includes(guard), `Exported function must include init guard:\n${wat}`);
  });

  test("literal-only global structs do not emit init guard global", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      let g: Point = { x = 2, y = 3 };
      export fn run(): i32 { return g.x; }
    `);
    assert(
      !wat.includes("$__globals_inited"),
      `Literal-only globals must not emit init flag:\n${wat}`,
    );
    assert(
      !wat.includes("i32.eqz (global.get $__globals_inited)"),
      `Unexpected init guard:\n${wat}`,
    );
  });

  test("f32 expression field uses f32.store in init block", () => {
    const { wat } = compile(`
      let seed: f32 = 1.5;
      struct Vec2 { x: f32, y: f32 }
      let v: Vec2 = { x = seed, y = 0.0 };
      export fn run(): f32 { return v.x; }
    `);
    assert(wat.includes("f32.store"), `Missing f32.store for f32 expression field:\n${wat}`);
    assert(wat.includes("global.get $seed"), `Missing global.get $seed for init:\n${wat}`);
  });

  test("mixed literal and expression fields emit one deferred store", () => {
    const { wat } = compile(`
      let offset: i32 = 11;
      struct Point { x: i32, y: i32 }
      let g: Point = { x = offset, y = 7 };
      export fn run(): i32 { return g.y; }
    `);
    const storeCount = (wat.match(/i32\.store/g) || []).length;
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
    const storeCount = (wat.match(/i32\.store/g) || []).length;
    assert.equal(storeCount, 2, `Expected two deferred i32.store ops, got ${storeCount}:\n${wat}`);
  });

  test("global struct reversed literal field order still stores by struct layout", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      let g: Point = { y = 2, x = 1 };
      export fn run(): i32 { return g.x; }
    `);
    assert(
      wat.includes("(data (offset"),
      `Expected data segment for global struct literal:\n${wat}`,
    );
    assert(
      wat.includes("\\01\\00\\00\\00\\02\\00\\00\\00"),
      `Expected x then y byte ordering in data segment:\n${wat}`,
    );
  });
});

describe("Emission: struct literal expression defense", () => {
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

describe("Compiler: inferred function call types", () => {
  test("inferred i32 from function call emits correct local.set", () => {
    const src = `
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn f(): void { let x = add(1, 2); }
    `;
    const { wat } = compile(src);
    assert(wat.includes("(local $x i32)"), "Expected i32 local for inferred call result");
    assert(wat.includes("(local.set $x (call $add"), "Expected local.set with call");
  });

  test("inferred f32 from function call emits correct local.set", () => {
    const src = `
      fn half(x: f32): f32 { return x; }
      fn f(): void { let y = half(1.0); }
    `;
    const { wat } = compile(src);
    assert(wat.includes("(local $y f32)"), "Expected f32 local for inferred call result");
  });
});

describe("Emission: multi-return and destructure", () => {
  test("multi-return function emits multi result clause", () => {
    const { wat } = compile("fn swap(a: i32, b: i32): (i32, i32) { return b, a; }");
    assert(wat.includes("(result i32 i32)"));
  });

  test("multi-return signature encodes all result lanes", () => {
    const { meta } = compile("fn pair(): (i32, i64) { return 1, 2 as i64; }");
    assert.equal(meta.functions.pair?.signature, "v_iI");
  });

  test("three-return signature encodes all result lanes", () => {
    const { meta, wat } = compile("fn tri(): (i32, i32, i32) { return 1, 2, 3; }");
    assert.equal(meta.functions.tri?.signature, "v_iii");
    assert(wat.includes("(result i32 i32 i32)"));
  });

  test("five-return signature encodes all result lanes", () => {
    const { meta, wat } = compile("fn many(): (i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5; }");
    assert.equal(meta.functions.many?.signature, "v_iiiii");
    assert(wat.includes("(result i32 i32 i32 i32 i32)"));
  });

  test("six-return signature encodes all result lanes", () => {
    const { meta, wat } = compile(
      "fn many6(): (i32, i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5, 6; }",
    );
    assert.equal(meta.functions.many6?.signature, "v_iiiiii");
    assert(wat.includes("(result i32 i32 i32 i32 i32 i32)"));
  });

  test("multi-value return emits both values", () => {
    const { wat } = compile("fn pair(): (i32, i32) { return 1, 2; }");
    assert(wat.includes("(return"));
    assert(wat.includes("i32.const 1"));
    assert(wat.includes("i32.const 2"));
  });

  test("pass-through return emits direct call return", () => {
    const { wat } = compile(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn p(): (i32, i32) { return swap(1, 2); }
    `);
    const pBody = wat.split("(func $p")[1] ?? "";
    assert(pBody.includes("(return (call $swap"), pBody);
  });

  test("destructuring let emits reverse local.set order", () => {
    const { wat } = compile(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): void { let (x, y) = swap(1, 2); }
    `);
    assertContainsInOrder(wat, ["(call $swap", "(local.set $y)", "(local.set $x)"]);
  });

  test("destructuring let with discard emits drop", () => {
    const { wat } = compile(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): void { let (_, y) = swap(1, 2); }
    `);
    assertContainsInOrder(wat, ["(call $swap", "(local.set $y)", "(drop)"]);
  });

  test("destructure locals are declared with per-result types", () => {
    const { wat } = compile(`
      fn pair(): (i32, i64) { return 1, 2 as i64; }
      fn f(): void { let (x, y) = pair(); }
    `);
    assert(wat.includes("(local $x i32)"));
    assert(wat.includes("(local $y i64)"));
  });

  test("statement-level multi-return call emits drops", () => {
    const { wat } = compile(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): void { swap(1, 2); }
    `);
    assertContainsInOrder(wat, ["(call $swap", "(drop)", "(drop)"]);
  });

  test("statement-level five-return call emits five drops", () => {
    const { wat } = compile(`
      fn many(): (i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5; }
      fn f(): void { many(); }
    `);
    const body = wat.split("(func $f")[1] ?? "";
    const dropCount = (body.match(/\(drop\)/g) ?? []).length;
    assert.equal(dropCount, 5, body);
  });

  test("destructuring five-return emits reverse order sets with discard drop", () => {
    const { wat } = compile(`
      fn many(): (i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5; }
      fn f(): void { let (a, _, c, d, e) = many(); }
    `);
    assertContainsInOrder(wat, [
      "(call $many",
      "(local.set $e)",
      "(local.set $d)",
      "(local.set $c)",
      "(drop)",
      "(local.set $a)",
    ]);
  });

  test("single-return still emits __ret_tmp for frame functions", () => {
    const { wat } = compile(`
      struct P { x: i32, y: i32 }
      fn f(): i32 { let p: P = { x = 1, y = 2 }; return p.x; }
    `);
    assert(wat.includes("(local $__ret_tmp i32)"));
  });

  test("multi-return frame function emits __mret locals", () => {
    const { wat } = compile(`
      struct P { x: i32, y: i32 }
      fn f(): (i32, i32) {
        let p: P = { x = 1, y = 2 };
        return p.x, p.y;
      }
    `);
    assert(wat.includes("(local $__mret_0 i32)"), wat);
    assert(wat.includes("(local $__mret_1 i32)"), wat);
  });
});

describe("Emission: stdlib global import", () => {
  test("imported f32 global emits import and global.get", () => {
    const { wat } = compile(`
      import PI from "math"
      fn f(): f32 { return PI; }
    `);
    assert(wat.includes('(import "math" "PI" (global $PI f32))'));
    assert(wat.includes("(global.get $PI)"));
  });
});

describe("Emission: named function references", () => {
  test("WAT section order: imports before table before globals before signatures before functions", () => {
    const { wat } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): i32 { let op: fn(i32,i32):i32 = add; return op(1, 2); }
    `);
    assertContainsInOrder(wat, ["(import", "(table", "(type $sig_", "(func $add"]);
  });

  test("fn table is emitted with correct size", () => {
    const { wat } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): i32 { let op: fn(i32,i32):i32 = add; return op(1, 2); }
    `);
    assert(wat.includes("(table $__fn_table 1 1 funcref)"), `Missing table: ${wat}`);
  });

  test("active elem initializes private trampolines without runtime table writes", () => {
    const { wat } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): i32 { let op: fn(i32,i32):i32 = add; return op(1, 2); }
    `);
    assert(
      wat.includes("(elem (i32.const 0) func $__indirect_add)"),
      `Missing active elem: ${wat}`,
    );
    assert(!wat.includes("__fn_table_inited"), `Unexpected table guard: ${wat}`);
    assert(!wat.includes("table.set"), `Unexpected runtime table write: ${wat}`);
    assert(!wat.includes('(export "__indirect_'), `Unexpected trampoline export: ${wat}`);
  });

  test("active elem follows deterministic fn-table slot order", () => {
    const { wat } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn sub(a: i32, b: i32): i32 { return a - b; }
      fn outer(): i32 {
        let second: fn(i32,i32):i32 = sub;
        let first: fn(i32,i32):i32 = add;
        return first(3, 2) + second(3, 2);
      }
    `);

    assert(
      wat.includes("(elem (i32.const 0) func $__indirect_sub $__indirect_add)"),
      `Wrong active elem order: ${wat}`,
    );
  });

  test("trampoline function forwards to original", () => {
    const { wat } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): i32 { let op: fn(i32,i32):i32 = add; return op(1, 2); }
    `);
    assert(wat.includes("(func $__indirect_add"), `Missing trampoline: ${wat}`);
    assert(wat.includes("(param $__env i32)"), `Trampoline missing env param: ${wat}`);
    assert(wat.includes("(call $add"), `Trampoline missing call: ${wat}`);
  });

  test("fn-type signature declared with env param", () => {
    const { wat } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): i32 { let op: fn(i32,i32):i32 = add; return op(1, 2); }
    `);
    assert(wat.includes("$sig_fn_i32_i32__i32"), `Missing sig name: ${wat}`);
    assert(
      wat.includes(
        "(type $sig_fn_i32_i32__i32 (func (param i32) (param i32) (param i32) (result i32)))",
      ),
      `Wrong sig decl: ${wat}`,
    );
  });

  test("__make_fnref helper is emitted when closure runtime needed", () => {
    const { wat } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): i32 { let op: fn(i32,i32):i32 = add; return op(1, 2); }
    `);
    assert(wat.includes("(func $__make_fnref"), `Missing __make_fnref: ${wat}`);
    assert(wat.includes("(call $alloc"), `__make_fnref missing alloc call: ${wat}`);
  });

  test("alloc import synthesized when closure runtime is needed", () => {
    const { wat } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): i32 { let op: fn(i32,i32):i32 = add; return op(1, 2); }
    `);
    assert(wat.includes('(import "memory" "malloc"'), `Missing alloc import: ${wat}`);
  });

  test("emitGet for function name produces call to __make_fnref", () => {
    const { wat } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): i32 { let op: fn(i32,i32):i32 = add; return op(1, 2); }
    `);
    assert(wat.includes("(call $__make_fnref (i32.const 0))"), `Missing fnref creation: ${wat}`);
  });

  test("indirect call emits call_indirect with env+args+idx order", () => {
    const { wat } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): i32 {
        let op: fn(i32,i32):i32 = add;
        return op(1, 2);
      }
    `);
    assertContainsInOrder(wat, [
      "(call_indirect (type $sig_fn_i32_i32__i32)",
      "(i32.load offset=4",
      "(i32.const 1)",
      "(i32.const 2)",
      "(i32.load offset=0",
    ]);
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

  test("same fn-type signature used by two functions is declared once", () => {
    const { wat } = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn sub(a: i32, b: i32): i32 { return a - b; }
      fn outer(): void {
        let a: fn(i32,i32):i32 = add;
        let b: fn(i32,i32):i32 = sub;
      }
    `);
    const count = (wat.match(/\$sig_fn_i32_i32__i32/g) ?? []).length;
    assert(count >= 1, "Signature should appear at least once");
    const typeCount = (wat.match(/\(type \$sig_fn_i32_i32__i32/g) ?? []).length;
    assert.equal(typeCount, 1, "Type declaration should appear exactly once");
  });

  test("no closure runtime when no fn-refs used", () => {
    const { wat } = compile(`fn add(a: i32, b: i32): i32 { return a + b; }`);
    assert(!wat.includes("(table"), `Should not emit table: ${wat}`);
    assert(!wat.includes("__make_fnref"), `Should not emit __make_fnref: ${wat}`);
    assert(!wat.includes("alloc"), `Should not emit alloc: ${wat}`);
  });

  test("void function reference emits correct sig type", () => {
    const { wat } = compile(`
      fn noop(): void {}
      fn outer(): void { let cb: fn():void = noop; }
    `);
    assert(wat.includes("$sig_fn___void"), `Missing void sig: ${wat}`);
    assert(wat.includes("(type $sig_fn___void (func (param i32)))"), `Wrong void sig decl: ${wat}`);
  });
});

describe("Emission: math stdlib calls", () => {
  test("Tier 1 f32 imports emit call", () => {
    const { wat } = compile(`
      import sqrt, floor, abs_f32 from "math"
      fn f(): f32 { return floor(sqrt(abs_f32(-4.0))); }
    `);
    assertContainsInOrder(wat, ['(import "math" "sqrt"', "(call $sqrt"]);
    assertContainsInOrder(wat, ["(call $floor", "(call $abs_f32"]);
  });

  test("Tier 1 f64 and abs_i32 imports emit call", () => {
    const { wat } = compile(`
      import sqrt_f64, abs_i32 from "math"
      fn f(): i32 { return abs_i32(-3); }
      fn g(): f64 { return sqrt_f64(9.0); }
    `);
    assert(wat.includes("(call $sqrt_f64"));
    assert(wat.includes("(call $abs_i32"));
  });

  test("Tier 2 imports emit call", () => {
    const { wat } = compile(`
      import sin, atan2, pow, fmod from "math"
      fn f(): f32 { return sin(0.1); }
      fn g(): f32 { return atan2(1.0, 1.0); }
      fn h(): f32 { return pow(2.0, 3); }
      fn i(): f32 { return fmod(3.0, 2.0); }
    `);
    assert(wat.includes("(call $sin"));
    assert(wat.includes("(call $atan2"));
    assert(wat.includes("(call $pow"));
    assert(wat.includes("(call $fmod"));
  });
});
