import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compiler } from "../src/compiler/compiler";
import type { ExportMeta } from "../src/compiler/emitters/emitter.types";
import { getPointerMemberData } from "../src/compiler/emitters/expression/member";
import { emitModule, extractModuleMeta } from "../src/compiler/emitters/module";
import { ModuleEmitter } from "../src/compiler/ModuleEmitter";
import { InfixExpression } from "../src/parser/ast/expressions/InfixExpression";
import { MemberExpression } from "../src/parser/ast/expressions/MemberExpression";
import type { ASTExpression } from "../src/parser/ast/types/ast.type";
import { Parser } from "../src/parser/Parser";
import { MapleError } from "../src/compiler/errors";

function compile(src: string) {
  const p = new Parser(src);
  const ast = p.parse("test");
  assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join(", ")}`);
  const meta = extractModuleMeta(ast);
  const mod = emitModule(ast, meta);
  const wat = mod.buildWat();
  return { ast, meta, mod, wat };
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

  test("struct let with mixed i32 and f32 members emits both", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: f32 }
      fn test(): void {
        let p: Point = { x = 10, y = 3.14 };
      }
    `);
    assert(wat.includes("p_x"));
    assert(wat.includes("p_y"));
  });

  test("struct let with only f32 members emits all members", () => {
    const { wat } = compile(`
      struct Vec2 { x: f32, y: f32 }
      fn test(): void {
        let v: Vec2 = { x = 1.5, y = 2.5 };
      }
    `);
    assert(wat.includes("v_x"));
    assert(wat.includes("v_y"));
  });

  test("struct i32 member used in binary arithmetic emits i32.add and loads both members", () => {
    const { wat } = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 {
        let p: Point = { x = 3, y = 4 };
        return p.x + p.y;
      }
    `);
    assert(wat.includes("i32.add"));
    assert(wat.includes("local.get $p_x"));
    assert(wat.includes("local.get $p_y"));
  });

  test("struct member used in comparison emits comparison opcode and loads member", () => {
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
    assert(wat.includes("i32.gt_s"));
    assert(wat.includes("local.get $c_n"));
  });

  test("struct f32 member used in binary arithmetic emits f32.add and loads both members", () => {
    const { wat } = compile(`
      struct Vec2 { x: f32, y: f32 }
      fn test(): f32 {
        let v: Vec2 = { x = 1.5, y = 2.5 };
        return v.x + v.y;
      }
    `);
    assert(wat.includes("f32.add"));
    assert(wat.includes("local.get $v_x"));
    assert(wat.includes("local.get $v_y"));
  });

  test("struct member as direct while-loop condition emits loop", () => {
    const { wat } = compile(`
      struct Flag { active: i32 }
      fn test(): void {
        let f: Flag = { active = 1 };
        while (f.active) {
          f.active = 0;
        }
      }
    `);
    assert(wat.includes("(loop"));
    assert(wat.includes("local.get $f_active"));
  });

  test("prefix minus on struct member emits negation", () => {
    const { wat } = compile(`
      struct Num { val: i32 }
      fn test(): i32 {
        let n: Num = { val = 7 };
        return -n.val;
      }
    `);
    assert(wat.includes("i32.sub"));
    assert(wat.includes("local.get $n_val"));
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
  test("if without else emits if/then", () => {
    const { wat } = compile("fn test(x: i32): i32 { if (x > 0) { return 1; } return 0; }");
    assert(wat.includes("(if"));
    assert(wat.includes("(then"));
  });

  test("if with else emits else block", () => {
    const { wat } = compile("fn test(x: i32): i32 { if (x > 0) { return 1; } else { return 2; } }");
    assert(wat.includes("(else"));
  });

  test("for loop emits loop and branch instructions", () => {
    const { wat } = compile("fn test(): void { for (let i: i32 = 0; i < 3; i = i + 1) { } }");
    assert(wat.includes("(loop"));
    assert(wat.includes("br_if"));
    assert(wat.includes("br $"));
  });

  test("while loop emits loop and branch instructions", () => {
    const { wat } = compile("fn test(): void { let i: i32 = 0; while (i < 3) { i = i + 1; } }");
    assert(wat.includes("(loop"));
    assert(wat.includes("br_if"));
  });

  test("break in loop emits branch", () => {
    const { wat } = compile("fn test(): void { while (true) { break; } }");
    assert(wat.includes("br $"));
  });
});

describe("Emission: Arithmetic", () => {
  test("i32 + emits i32.add", () => {
    const { wat } = compile("fn test(): i32 { return 1 + 2; }");
    assert(wat.includes("i32.add"));
  });

  test("f32 + emits f32.add", () => {
    const { wat } = compile("fn test(): f32 { return 1.0 + 2.0; }");
    assert(wat.includes("f32.add"));
  });

  test("i32 -, *, / emit expected opcodes", () => {
    const { wat } = compile("fn test(a: i32, b: i32): i32 { return (a - b) * (a / b); }");
    assert(wat.includes("i32.sub"));
    assert(wat.includes("i32.mul"));
    assert(wat.includes("i32.div_s"));
  });

  test("f32 -, *, / emit expected opcodes", () => {
    const { wat } = compile("fn test(a: f32, b: f32): f32 { return (a - b) * (a / b); }");
    assert(wat.includes("f32.sub"));
    assert(wat.includes("f32.mul"));
    assert(wat.includes("f32.div"));
  });

  test("i32 % emits i32.rem_s", () => {
    const { wat } = compile("fn test(a: i32, b: i32): i32 { return a % b; }");
    assert(wat.includes("i32.rem_s"));
  });
});

describe("Emission: Comparisons", () => {
  test("i32 > and < emit signed i32 comparison opcodes", () => {
    const { wat } = compile(`
      fn gt(a: i32, b: i32): i32 { return a > b; }
      fn lt(a: i32, b: i32): i32 { return a < b; }
    `);
    assert(wat.includes("i32.gt_s"));
    assert(wat.includes("i32.lt_s"));
  });

  test("f32 > and < emit f32 comparison opcodes", () => {
    const { wat } = compile(`
      fn gt(a: f32, b: f32): i32 { return a > b; }
      fn lt(a: f32, b: f32): i32 { return a < b; }
    `);
    assert(wat.includes("f32.gt"));
    assert(wat.includes("f32.lt"));
  });

  test("i32 >= and <= emit signed ge/le opcodes", () => {
    const { wat } = compile(`
      fn gte(a: i32, b: i32): i32 { return a >= b; }
      fn lte(a: i32, b: i32): i32 { return a <= b; }
    `);
    assert(wat.includes("i32.ge_s"));
    assert(wat.includes("i32.le_s"));
  });

  test("f32 >= and <= emit f32 ge/le opcodes", () => {
    const { wat } = compile(`
      fn gte(a: f32, b: f32): i32 { return a >= b; }
      fn lte(a: f32, b: f32): i32 { return a <= b; }
    `);
    assert(wat.includes("f32.ge"));
    assert(wat.includes("f32.le"));
  });

  test("== and != emit eq/ne opcodes", () => {
    const { wat } = compile(`
      fn eqi(a: i32, b: i32): i32 { return a == b; }
      fn nei(a: i32, b: i32): i32 { return a != b; }
      fn eqf(a: f32, b: f32): i32 { return a == b; }
      fn nef(a: f32, b: f32): i32 { return a != b; }
    `);
    assert(wat.includes("i32.eq"));
    assert(wat.includes("i32.ne"));
    assert(wat.includes("f32.eq"));
    assert(wat.includes("f32.ne"));
  });
});

describe("Emission: Bitwise / Logical / Shift Ops", () => {
  test("&& and || emit i32.and / i32.or", () => {
    const { wat } = compile(`
      fn test(a: i32, b: i32): i32 {
        return (a && b) || (a && 1);
      }
    `);
    assert(wat.includes("i32.and"));
    assert(wat.includes("i32.or"));
  });

  test("& | ^ emit bitwise opcodes", () => {
    const { wat } = compile("fn test(a: i32, b: i32): i32 { return (a & b) | (a ^ b); }");
    assert(wat.includes("i32.and"));
    assert(wat.includes("i32.or"));
    assert(wat.includes("i32.xor"));
  });

  test("<< and >> emit shift opcodes", () => {
    const { wat } = compile("fn test(a: i32): i32 { return (a << 1) >> 1; }");
    assert(wat.includes("i32.shl"));
    assert(wat.includes("i32.shr_s"));
  });
});

describe("Emission: Prefix/Postfix", () => {
  test("logical not emits i32.eqz", () => {
    const { wat } = compile("fn test(x: i32): i32 { return !x; }");
    assert(wat.includes("i32.eqz"));
  });

  test("prefix minus emits arithmetic negation", () => {
    const { wat } = compile("fn test(x: i32): i32 { return -x; }");
    assert(wat.includes("(i32.sub (i32.const 0)"));
  });

  test("prefix minus emits f32.neg for floats", () => {
    const { wat } = compile("fn test(x: f32): f32 { return -x; }");
    assert(wat.includes("f32.neg"));
  });

  test("bitwise not emits xor -1", () => {
    const { wat } = compile("fn test(x: i32): i32 { return ~x; }");
    assert(wat.includes("i32.xor"));
    assert(wat.includes("(i32.const -1)"));
  });

  test("postfix increment/decrement emit updates", () => {
    const { wat } = compile(`
      fn test(): i32 {
        let x: i32 = 3;
        x++;
        x--;
        return x;
      }
    `);
    assert(wat.includes("local.set $x"));
    // x++ → (local.set $x (i32.add (local.get $x) (i32.const 1)))
    assert(wat.includes("(i32.const 1)"));
    // x-- → (local.set $x (i32.add (local.get $x) (i32.const -1)))
    assert(wat.includes("(i32.const -1)"));
  });
});

describe("Emission: Cast", () => {
  test("i32 as f32 emits f32.convert_i32_s", () => {
    const { wat } = compile("fn test(x: i32): f32 { return x as f32; }");
    assert(wat.includes("f32.convert_i32_s"));
  });

  test("f32 as i32 emits i32.trunc_f32_s", () => {
    const { wat } = compile("fn test(x: f32): i32 { return x as i32; }");
    assert(wat.includes("i32.trunc_f32_s"));
  });

  test("i32 as u8 emits no conversion opcode (same WASM type)", () => {
    const { wat } = compile("fn test(n: i32): i32 { return n as u8; }");
    assert(!wat.includes("convert"));
    assert(!wat.includes("trunc"));
    assert(wat.includes("local.get $n"));
  });

  test("cast inside binary expression resolves correct type", () => {
    const { wat } = compile("fn test(x: i32): f32 { return x as f32 + 1.0; }");
    assert(wat.includes("f32.add"));
    assert(wat.includes("f32.convert_i32_s"));
  });
});

describe("Emission: Postfix Statement", () => {
  test("idx++ as statement emits plain local.set, not block-with-result", () => {
    const { wat } = compile("fn test(): i32 { let idx: i32 = 0; idx++; return idx; }");
    assert(wat.includes("(local.set $idx"), "Must mutate idx");
    assert(
      !wat.includes("(block (result i32)"),
      "Statement-level postfix must not emit (block (result i32)) — that leaves a value on the stack",
    );
  });

  test("idx-- as statement emits plain local.set, not block-with-result", () => {
    const { wat } = compile("fn test(): i32 { let idx: i32 = 5; idx--; return idx; }");
    assert(wat.includes("(local.set $idx"), "Must mutate idx");
    assert(
      !wat.includes("(block (result i32)"),
      "Statement-level postfix must not emit (block (result i32))",
    );
  });

  test("idx++ as statement increments by 1 in emitted WAT", () => {
    const { wat } = compile("fn test(): i32 { let idx: i32 = 0; idx++; return idx; }");
    // Must emit: (local.set $idx (i32.add (local.get $idx) (i32.const 1)))
    assert(wat.includes("(i32.add (local.get $idx) (i32.const 1))"), "Must increment by 1");
  });

  test("idx-- as statement decrements by 1 in emitted WAT", () => {
    const { wat } = compile("fn test(): i32 { let idx: i32 = 5; idx--; return idx; }");
    // Must emit: (local.set $idx (i32.add (local.get $idx) (i32.const -1)))
    assert(wat.includes("(i32.add (local.get $idx) (i32.const -1))"), "Must decrement by 1");
  });

  test("postfix as rvalue still emits block-with-result", () => {
    // When postfix is used as an expression (not a statement), the old value must be returned
    const { wat } = compile("fn test(): i32 { let idx: i32 = 0; let x: i32 = idx++; return x; }");
    assert(wat.includes("(block (result i32)"), "Rvalue postfix must emit block with result");
  });
});

describe("Emission: Compound Assignments", () => {
  test("compound assigns are desugared through binary ops", () => {
    const { wat } = compile(`
      fn test(): i32 {
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
    assert(wat.includes("i32.add"));
    assert(wat.includes("i32.sub"));
    assert(wat.includes("i32.mul"));
    assert(wat.includes("i32.div_s"));
    assert(wat.includes("i32.rem_s"));
    assert(wat.includes("i32.or"));
    assert(wat.includes("i32.and"));
    assert(wat.includes("i32.xor"));
    assert(wat.includes("i32.shl"));
    assert(wat.includes("i32.shr_s"));
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

  test("member access rejects non-identifier parent", () => {
    const token = {
      type: "Identifier" as const,
      literal: "x",
      col: 0,
      line: 0,
      end: 0,
      start: 0,
    };
    const nonIdent = new InfixExpression(
      token,
      "dummy" as unknown as ASTExpression,
      "+",
      "dummy" as unknown as ASTExpression,
    );
    const memberExpr = new MemberExpression(token, nonIdent as unknown as ASTExpression, "field");
    const meta = extractModuleMeta(new Parser("").parse("test"));
    const emitter = new ModuleEmitter(meta);

    assert.throws(() => getPointerMemberData(memberExpr, emitter), {
      message: /only identifier expressions/,
    });
  });

  test("member assignment compiles for flattened struct locals", () => {
    const { wat } = compile(`
      struct Thing { a: i32 }
      fn test(): void {
        let t: Thing = { a = 1 };
        t.a = 14;
      }
    `);
    assert(wat.includes("t_a"));
    assert(wat.includes("(local.set $t_a (i32.const 14))"));
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
  test("integer literal emits i32.const", () => {
    const { wat } = compile("fn test(): i32 { return 42; }");
    assert(wat.includes("(i32.const 42)"));
  });

  test("float literal emits f32.const", () => {
    const { wat } = compile("fn test(): f32 { return 3.14; }");
    assert(wat.includes("(f32.const 3.14)"));
  });

  test("boolean literals emit i32 consts", () => {
    const { wat } = compile("fn t1(): i32 { return true; } fn t2(): i32 { return false; }");
    assert(wat.includes("(i32.const 1)"));
    assert(wat.includes("(i32.const 0)"));
  });

  test("string literal in let emits pointer constant and data segment", () => {
    const { wat } = compile('fn test(): i32 { let s: string = "hello"; return 0; }');
    assert(wat.includes("(local $s i32)"), `Missing local string slot:\n${wat}`);
    assert(wat.includes("(local.set $s (i32.const"), `Missing pointer constant emit:\n${wat}`);
    assert(wat.includes('(data (offset (i32.const'), `Missing data segment emit:\n${wat}`);
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
    meta.imports.foo.resolved = true;
    meta.imports.foo.info = {
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
  test("else if chain emits nested if/else WAT", () => {
    const { wat } = compile(`
      fn grade(score: i32): i32 {
        if (score >= 90) {
          return 5;
        } else if (score >= 75) {
          return 4;
        } else {
          return 3;
        }
      }
    `);
    assert(wat.includes("(if"));
    assert(wat.includes("(else"));
    // two separate return values prove both branches compiled
    assert(wat.includes("(i32.const 5)"));
    assert(wat.includes("(i32.const 4)"));
    assert(wat.includes("(i32.const 3)"));
  });

  test("three-level else if chain compiles", () => {
    const { wat } = compile(`
      fn classify(n: i32): i32 {
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
    assert(wat.includes("(i32.const 10)"));
    assert(wat.includes("(i32.const 20)"));
    assert(wat.includes("(i32.const 30)"));
    assert(wat.includes("(i32.const 40)"));
  });
});

describe("Emission: continue", () => {
  test("continue in for loop emits br to loop label", () => {
    const { wat } = compile(`
      fn test(): void {
        for (let i: i32 = 0; i < 10; i = i + 1) {
          continue;
        }
      }
    `);
    assert(wat.includes("(loop"));
    assert(wat.includes("(br $loop_"));
  });

  test("continue in while loop emits br to loop label", () => {
    const { wat } = compile(`
      fn test(): void {
        let i: i32 = 0;
        while (i < 5) {
          i = i + 1;
          continue;
        }
      }
    `);
    assert(wat.includes("(loop"));
    assert(wat.includes("(br $loop_"));
  });
});

describe("Emission: const", () => {
  test("const global emits without mut", () => {
    const { wat } = compile(`const MAX: i32 = 100;`);
    assert(wat.includes("(global $MAX i32 (i32.const 100))"));
    assert(!wat.includes("(global $MAX (mut i32)"));
  });

  test("let global still emits with mut", () => {
    const { wat } = compile(`let x: i32 = 0;`);
    assert(wat.includes("(global $x (mut i32) (i32.const 0))"));
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

describe("Emission: switch", () => {
  test("switch emits br_table", () => {
    const { wat } = compile(`
      fn classify(x: i32): i32 {
        switch (x) {
          case 0: { return 10; }
          case 1: { return 20; }
          default: { return 99; }
        }
      }
    `);
    assert(wat.includes("br_table"));
    assert(wat.includes("(i32.const 10)"));
    assert(wat.includes("(i32.const 20)"));
    assert(wat.includes("(i32.const 99)"));
  });

  test("switch without default emits br_table with fallthrough", () => {
    const { wat } = compile(`
      fn test(x: i32): void {
        switch (x) {
          case 0: { return; }
          case 1: { return; }
        }
      }
    `);
    assert(wat.includes("br_table"));
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

  test("emitted wat is wrapped in module", () => {
    const { wat } = compile("fn test(): void {}");
    assert(wat.startsWith("(module"));
    assert(wat.endsWith(")"));
  });

  test("emitted wat includes runtime memory import", () => {
    const { wat } = compile("fn test(): void {}");
    assert(wat.includes('(import "runtime" "memory" (memory 2))'));
  });
});

describe("Emission: Type inference", () => {
  test("inferred i32 local emits correct local declaration and set", () => {
    const { wat } = compile("fn f(): void { let x = 5; }");
    assert(wat.includes("(local $x i32)"), `Missing (local $x i32) in:\n${wat}`);
    assert(wat.includes("(local.set $x (i32.const 5))"), `Missing local.set in:\n${wat}`);
  });

  test("inferred f32 local emits correct local declaration and set", () => {
    const { wat } = compile("fn f(): void { let y = 3.14; }");
    assert(wat.includes("(local $y f32)"), `Missing (local $y f32) in:\n${wat}`);
    assert(wat.includes("(local.set $y (f32.const 3.14))"), `Missing local.set in:\n${wat}`);
  });
});

describe("Emission: Strings", () => {
  test("explicit string local emits i32 local and string pointer set", () => {
    const { wat } = compile('fn f(): void { let s: string = "hello"; }');
    assert(wat.includes("(local $s i32)"), `Missing (local $s i32) in:\n${wat}`);
    assert(wat.includes("(local.set $s (i32.const"), `Missing string pointer set in:\n${wat}`);
    assert(wat.includes('(data (offset (i32.const'), `Missing data segment in:\n${wat}`);
  });

  test("inferred string local emits i32 local and string pointer set", () => {
    const { wat } = compile('fn f(): void { let s = "world"; }');
    assert(wat.includes("(local $s i32)"), `Missing (local $s i32) in:\n${wat}`);
    assert(wat.includes("(local.set $s (i32.const"), `Missing string pointer set in:\n${wat}`);
    assert(wat.includes('(data (offset (i32.const'), `Missing data segment in:\n${wat}`);
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

// ─── 8D: Control Flow Hardening ───────────────────────────────────────────────

describe("Emission: Control Flow Hardening - For init (Bug 1)", () => {
  test("for loop with non-zero init emits local.set before the loop block", () => {
    // RED: init is never emitted by emitForStatement - WASM locals default to 0
    const { wat } = compile("fn f(): void { for (let i: i32 = 5; i < 10; i = i + 1) { } }");
    const setIdx = wat.indexOf("(local.set $i (i32.const 5))");
    const blockIdx = wat.indexOf("(block $break_");
    assert(setIdx !== -1, `Missing (local.set $i (i32.const 5)) in:\n${wat}`);
    assert(setIdx < blockIdx, `Init local.set must appear before (block $break_) in:\n${wat}`);
  });

  test("for loop with negative init emits local.set before the loop block", () => {
    // RED: same bug - negative non-zero init silently becomes 0
    const { wat } = compile("fn f(): void { for (let i: i32 = -3; i < 7; i = i + 1) { } }");
    const setIdx = wat.indexOf("(local.set $i");
    const blockIdx = wat.indexOf("(block $break_");
    assert(setIdx !== -1, `Missing (local.set $i) for negative init in:\n${wat}`);
    assert(setIdx < blockIdx, `Init local.set must appear before (block $break_) in:\n${wat}`);
  });

  test("for loop with zero init still emits local.set before the loop block", () => {
    // GREEN: zero init "works by accident" today but should be explicit
    const { wat } = compile("fn f(): void { for (let i: i32 = 0; i < 3; i = i + 1) { } }");
    const blockIdx = wat.indexOf("(block $break_");
    assert(blockIdx !== -1, `Missing (block $break_) in:\n${wat}`);
    // After fix, local.set $i (i32.const 0) should appear before (block
    const setIdx = wat.indexOf("(local.set $i");
    assert(setIdx !== -1, `Missing (local.set $i) in:\n${wat}`);
    assert(setIdx < blockIdx, `Init local.set must appear before (block $break_) in:\n${wat}`);
  });
});

describe("Emission: Control Flow Hardening - If result type (Bug 3)", () => {
  test("if/else both returning f32 emits (result f32) not (result i32)", () => {
    // RED: result type is hardcoded to i32 in if.ts
    const { wat } = compile(
      `fn f(x: i32): f32 { if (x > 0) { return 1.0; } else { return 2.0; } }`,
    );
    assert(!wat.includes("(result i32)"), `Should not emit (result i32) for f32-returning branches:\n${wat}`);
  });

  test("nested if returns that are all f32 still emit outer (result f32)", () => {
    const { wat } = compile(`
      fn f(x: i32): f32 {
        if (x > 0) {
          if (x > 1) { return 1.0; } else { return 2.0; }
        } else {
          return 3.0;
        }
      }
    `);
    assert(wat.includes("(if (result f32)"), `Expected outer if (result f32) in:\n${wat}`);
    assert(!wat.includes("(if (result i32)"), `Outer if must not be i32 in:\n${wat}`);
  });

  test("if with only void returns does not emit a synthetic result type", () => {
    const { wat } = compile(`
      fn f(x: i32): void {
        if (x > 0) { return; } else { return; }
      }
    `);
    assert(!wat.includes("(if (result i32)"), `Void-returning if should not emit (result i32):\n${wat}`);
    assert(!wat.includes("(if (result f32)"), `Void-returning if should not emit (result f32):\n${wat}`);
  });

  test("if/else both returning i32 emits (result i32)", () => {
    // GREEN: i32 case should still work correctly
    const { wat } = compile(
      `fn f(x: i32): i32 { if (x > 0) { return 1; } else { return 2; } }`,
    );
    assert(wat.includes("(result i32)"), `Expected (result i32) for i32-returning branches:\n${wat}`);
  });
});

describe("Emission: Control Flow Hardening - Loop conditions (Bug 4)", () => {
  test("if with void function as condition throws MapleError", () => {
    assert.throws(
      () => compile(`fn noop(): void {} fn f(): void { if (noop()) { return; } }`),
      (e: unknown) => e instanceof MapleError || (e instanceof Error && e.message.length > 0),
    );
  });

  test("if with f32 condition emits f32.ne (normalized to i32)", () => {
    const { wat } = compile(`fn f(): void { let x: f32 = 1.0; if (x) { return; } }`);
    assert(wat.includes("f32.ne"), `Expected f32.ne for if condition in:\n${wat}`);
  });

  test("if with i32 condition emits i32.ne (normalized to i32)", () => {
    const { wat } = compile(`fn f(): void { let x: i32 = 1; if (x) { return; } }`);
    assert(wat.includes("i32.ne"), `Expected i32.ne for if condition in:\n${wat}`);
  });

  test("for loop with void function as condition throws MapleError", () => {
    // RED: void condition falls through to f32.ne, producing invalid WAT instead of error
    assert.throws(
      () => compile(`fn noop(): void {} fn f(): void { for (let i: i32 = 0; noop(); i = i + 1) { } }`),
      (e: unknown) => e instanceof MapleError || (e instanceof Error && e.message.length > 0),
    );
  });

  test("while loop with void function as condition throws MapleError", () => {
    // RED: same void condition fallthrough bug in while.ts
    assert.throws(
      () => compile(`fn noop(): void {} fn f(): void { while (noop()) { } }`),
      (e: unknown) => e instanceof MapleError || (e instanceof Error && e.message.length > 0),
    );
  });

  test("for loop with f32 condition emits f32.ne (explicit branch, not fallthrough)", () => {
    // GREEN: f32 conditions should work correctly via the explicit f32.ne branch
    const { wat } = compile(
      `fn f(): void { let x: f32 = 1.0; for (let i: i32 = 0; x; i = i + 1) { } }`,
    );
    assert(wat.includes("f32.ne"), `Expected f32.ne for f32 condition in:\n${wat}`);
  });

  test("while loop with bool condition passes through directly without ne wrapper", () => {
    // GREEN: bool conditions should not be wrapped in i32.ne
    const { wat } = compile(`fn f(): void { let b: bool = true; while (b) { break; } }`);
    assert(wat.includes("(local.get $b)"), `Expected direct bool condition in:\n${wat}`);
  });

  test("while loop with i32 condition wraps in i32.ne", () => {
    // GREEN: i32 conditions should use i32.ne ... 0
    const { wat } = compile(`fn f(): void { let i: i32 = 0; while (i) { break; } }`);
    assert(wat.includes("i32.ne"), `Expected i32.ne for i32 condition in:\n${wat}`);
  });
});

describe("Emission: Control Flow Hardening - Break/Continue outside loop (Bug 2)", () => {
  test("break outside any loop or switch throws error", () => {
    // RED: currently emits (br undefined) without error
    assert.throws(
      () => compile("fn f(): void { break; }"),
      (e: unknown) => e instanceof MapleError || (e instanceof Error && e.message.length > 0),
    );
  });

  test("continue outside any loop throws error", () => {
    // RED: currently emits (br undefined) without error
    assert.throws(
      () => compile("fn f(): void { continue; }"),
      (e: unknown) => e instanceof MapleError || (e instanceof Error && e.message.length > 0),
    );
  });

  test("break in for loop emits valid br instruction", () => {
    // GREEN: break in a loop must still work
    const { wat } = compile(
      "fn f(): void { for (let i: i32 = 0; i < 5; i = i + 1) { break; } }",
    );
    assert(wat.includes("(br $break_"), `Expected (br $break_...) in:\n${wat}`);
  });

  test("continue in for loop emits valid br instruction to loop label", () => {
    // GREEN: continue in a loop must still work
    const { wat } = compile(
      "fn f(): void { for (let i: i32 = 0; i < 5; i = i + 1) { continue; } }",
    );
    assert(wat.includes("(br $loop_"), `Expected (br $loop_...) in:\n${wat}`);
  });

  test("break in while loop emits valid br instruction", () => {
    // GREEN
    const { wat } = compile("fn f(): void { while (1) { break; } }");
    assert(wat.includes("(br $break_"), `Expected (br $break_...) in:\n${wat}`);
  });

  test("continue in while loop emits valid br instruction", () => {
    // GREEN
    const { wat } = compile(
      "fn f(): void { let i: i32 = 0; while (i < 5) { i = i + 1; continue; } }",
    );
    assert(wat.includes("(br $loop_"), `Expected (br $loop_...) in:\n${wat}`);
  });
});

describe("Emission: Control Flow Hardening - Switch break (Fix 7)", () => {
  test("break in standalone switch does not emit (br undefined)", () => {
    // RED: switch does not push a break label, so (br undefined) is emitted
    const { wat } = compile(`
      fn f(x: i32): void {
        switch (x) {
          case 0: { break; }
          default: { break; }
        }
      }
    `);
    assert(!wat.includes("(br undefined)"), `WAT must not contain (br undefined):\n${wat}`);
  });

  test("break inside switch inside for loop targets the switch exit, not the for loop", () => {
    // RED: break currently targets the for loop's break label (wrong)
    const { wat } = compile(`
      fn f(x: i32): void {
        for (let i: i32 = 0; i < 5; i = i + 1) {
          switch (x) {
            case 0: { break; }
            default: { break; }
          }
        }
      }
    `);
    assert(!wat.includes("(br undefined)"), `WAT must not contain (br undefined):\n${wat}`);
    // The switch should have its own labeled block
    assert(wat.includes("$switch_"), `Expected switch-specific labels in:\n${wat}`);
  });

  test("continue inside switch inside for loop targets the for loop", () => {
    // GREEN (after fix 7): continue in switch should target enclosing loop
    const { wat } = compile(`
      fn f(x: i32): void {
        for (let i: i32 = 0; i < 5; i = i + 1) {
          switch (x) {
            case 0: { continue; }
            default: { break; }
          }
        }
      }
    `);
    assert(wat.includes("$loop_"), `Expected loop label for continue:\n${wat}`);
    assert(!wat.includes("(br undefined)"), `WAT must not contain (br undefined):\n${wat}`);
  });

  test("switch case body still has implicit exit after case body", () => {
    // GREEN: existing Go-style no-fall-through behavior must not regress
    const { wat } = compile(`
      fn f(x: i32): i32 {
        switch (x) {
          case 0: { return 10; }
          default: { return 99; }
        }
      }
    `);
    assert(wat.includes("br_table"), `Expected br_table in switch:\n${wat}`);
  });
});

describe("Emission: Control Flow Hardening - Nested constructs", () => {
  test("nested for loops - break in inner loop targets inner loop's break label", () => {
    // GREEN: nested loops should each have independent break/loop labels
    const { wat } = compile(`
      fn f(): void {
        for (let i: i32 = 0; i < 3; i = i + 1) {
          for (let j: i32 = 0; j < 3; j = j + 1) {
            break;
          }
        }
      }
    `);
    assert(!wat.includes("(br undefined)"), `No (br undefined) in nested loops:\n${wat}`);
    // There should be two distinct break labels
    const breakMatches = wat.match(/\$break_\d+/g) ?? [];
    const uniqueBreaks = new Set(breakMatches);
    assert(uniqueBreaks.size >= 2, `Expected at least 2 distinct break labels in:\n${wat}`);
  });

  test("if inside for loop with break targets the for loop", () => {
    // GREEN
    const { wat } = compile(`
      fn f(): void {
        for (let i: i32 = 0; i < 5; i = i + 1) {
          if (i > 2) { break; }
        }
      }
    `);
    assert(!wat.includes("(br undefined)"), `No (br undefined):\n${wat}`);
    assert(wat.includes("(br $break_"), `Expected break label:\n${wat}`);
  });

  test("return inside for loop inside if emits return correctly", () => {
    // GREEN
    const { wat } = compile(`
      fn f(x: i32): i32 {
        if (x > 0) {
          for (let i: i32 = 0; i < x; i = i + 1) {
            return i;
          }
        }
        return 0;
      }
    `);
    assert(wat.includes("(return"), `Expected return instruction in:\n${wat}`);
  });
});

describe("Emission: Control Flow Hardening - Flow analysis (Bug 10)", () => {
  test("switch without default in if then-branch does not cause spurious (result i32)", () => {
    const { wat } = compile(`
      fn f(x: i32, y: i32): i32 {
        if (x > 0) {
          switch (y) {
            case 0: { return 1; }
          }
        } else {
          return 2;
        }
        return 3;
      }
    `);
    const matches = wat.match(/\(result i32\)/g) ?? [];
    assert.equal(
      matches.length,
      1,
      `Expected exactly 1 (result i32) from fn sig only, got ${matches.length}:\n${wat}`,
    );
  });

  test("for loop in if then-branch does not cause spurious (result i32) on if", () => {
    // RED: stmtDefinitelyReturns(forStatement) incorrectly returns true,
    // causing extractNeedsReturn to annotate the if with (result i32)
    // which makes the (then) block required to produce a value - invalid WAT
    const { wat } = compile(`
      fn f(x: i32): i32 {
        if (x > 0) {
          for (let i: i32 = 0; i < x; i = i + 1) {
            return 1;
          }
        } else {
          return -1;
        }
        return 0;
      }
    `);
    // Should have exactly 1 (result i32) - from the function signature only
    const matches = wat.match(/\(result i32\)/g) ?? [];
    assert.equal(
      matches.length,
      1,
      `Expected exactly 1 (result i32) from fn sig only, got ${matches.length}:\n${wat}`,
    );
  });

  test("while loop in if then-branch does not cause spurious (result i32) on if", () => {
    // RED: same bug for while loops
    const { wat } = compile(`
      fn f(x: i32): i32 {
        if (x > 0) {
          while (x > 0) {
            return 1;
          }
        } else {
          return -1;
        }
        return 0;
      }
    `);
    const matches = wat.match(/\(result i32\)/g) ?? [];
    assert.equal(
      matches.length,
      1,
      `Expected exactly 1 (result i32) from fn sig only, got ${matches.length}:\n${wat}`,
    );
  });

  test("if/else where both branches have explicit returns emits (result i32)", () => {
    // GREEN: genuine both-branches-return case should still get (result i32)
    const { wat } = compile(
      `fn f(x: i32): i32 { if (x > 0) { return 1; } else { return -1; } }`,
    );
    assert(wat.includes("(result i32)"), `Expected (result i32) when both branches return:\n${wat}`);
  });
});
