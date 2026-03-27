import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Parser } from "../src/parser/Parser";
import { InfixExpression } from "../src/parser/ast/expressions/InfixExpression";
import { MemberExpression } from "../src/parser/ast/expressions/MemberExpression";
import { extractModuleMeta, emitModule } from "../src/compiler/emitters/module";
import { getPointerMemberData } from "../src/compiler/emitters/expression/member";
import { ModuleEmitter } from "../src/compiler/ModuleEmitter";
import { compiler } from "../src/compiler/compiler";

function compile(src: string) {
  const p = new Parser(src);
  const ast = p.parse("test");
  assert.equal(
    p.errors.length,
    0,
    `Parse errors: ${p.errors.map((e) => e.message).join(", ")}`
  );
  const meta = extractModuleMeta(ast);
  const mod = emitModule(ast, meta);
  const wat = mod.buildWat();
  return { ast, meta, mod, wat };
}

function compileThrows(src: string, pattern?: RegExp): void {
  if (pattern) {
    assert.throws(() => compile(src), {
      message: pattern,
    });
    return;
  }
  assert.throws(() => compile(src));
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
    const { wat } = compile(
      "fn callee(): i32 { return 1; } fn caller(): i32 { return callee(); }"
    );
    assert(/\(call \$callee\s*\)/.test(wat));
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
    assert(meta.structs["S"] !== undefined);
    assert(meta.structs["S"].members["a"] !== undefined);
    assert(meta.structs["S"].members["b"] !== undefined);
    assert.equal(meta.structs["S"].size, 8);
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

  test("f32 > and < currently lower to unsigned i32 comparisons", () => {
    const { wat } = compile(`
      fn gt(a: f32, b: f32): i32 { return a > b; }
      fn lt(a: f32, b: f32): i32 { return a < b; }
    `);
    assert(wat.includes("i32.gt_u"));
    assert(wat.includes("i32.lt_u"));
  });
});

describe("Emission: Unimplemented Ops", () => {
  test("modulo throws not implemented", () => {
    compileThrows("fn test(): i32 { return 10 % 3; }", /not implemented/);
  });

  test("equals throws not implemented", () => {
    compileThrows("fn test(): i32 { return 1 == 1; }", /not implemented/);
  });

  test("not equals throws not implemented", () => {
    compileThrows("fn test(): i32 { return 1 != 2; }", /not implemented/);
  });

  test("logical and/or throw not implemented", () => {
    compileThrows("fn test(): i32 { return (1 < 2) && (2 < 3); }", /not implemented/);
    compileThrows("fn test(): i32 { return (1 < 2) || (2 < 3); }", /not implemented/);
  });

  test("bitwise ops throw not implemented", () => {
    compileThrows("fn test(): i32 { return 1 & 2; }", /not implemented/);
    compileThrows("fn test(): i32 { return 1 | 2; }", /not implemented/);
    compileThrows("fn test(): i32 { return 1 ^ 2; }", /not implemented/);
  });

  test("postfix increment/decrement throw not implemented", () => {
    compileThrows("fn test(): i32 { let x: i32 = 0; x++; return x; }", /emit not implemented/);
    compileThrows("fn test(): i32 { let x: i32 = 0; x--; return x; }", /emit not implemented/);
  });
});

describe("Emission: Prefix/Postfix", () => {
  test("logical not emits i32.eqz", () => {
    const { wat } = compile("fn test(x: i32): i32 { return !x; }");
    assert(wat.includes("i32.eqz"));
  });

  test("prefix minus currently emits i32.eqz", () => {
    const { wat } = compile("fn test(x: i32): i32 { return -x; }");
    assert(wat.includes("i32.eqz"));
  });

  test("bitwise not currently emits i32.eqz", () => {
    const { wat } = compile("fn test(x: i32): i32 { return ~x; }");
    assert(wat.includes("i32.eqz"));
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
    const nonIdent = new InfixExpression(token, "dummy" as any, "+", "dummy" as any);
    const memberExpr = new MemberExpression(token, nonIdent as any, "field");
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
    const { wat } = compile("fn test(): i32 { let arr: i32[] = [1, 2, 3]; let x: i32 = 1; return arr[x]; }");
    assert(wat.includes("i32.mul"));
    assert(wat.includes("i32.add"));
  });

  test("expression index emits computed offset load", () => {
    const { wat } = compile("fn test(): i32 { let arr: i32[] = [1, 2, 3]; let x: i32 = 1; return arr[x + 1]; }");
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

  test("string literal currently fails to parse as expression", () => {
    const p = new Parser('fn test(): i32 { return "hello"; }');
    p.parse("test");
    assert(p.errors.length > 0);
    assert(
      p.errors.some((e) =>
        e.message.includes("No prefix parse function found for StringLiteral")
      )
    );
  });

  test("char literal currently fails to parse as expression", () => {
    const p = new Parser("fn test(): i32 { return 'a'; }");
    p.parse("test");
    assert(p.errors.length > 0);
    assert(
      p.errors.some((e) =>
        e.message.includes("No prefix parse function found for CharLiteral")
      )
    );
  });
});

describe("Module Metadata", () => {
  test("single import populates metadata", () => {
    const { meta } = compile('import foo from "mod"');
    assert(meta.imports["foo"] !== undefined);
    assert.equal(meta.imports["foo"].module, "mod");
  });

  test("multi import populates metadata entries", () => {
    const { meta } = compile('import a, b from "mod"');
    assert(meta.imports["a"] !== undefined);
    assert(meta.imports["b"] !== undefined);
  });

  test("import emission includes import and type when import is resolved as function", () => {
    const p = new Parser('import foo from "mod"');
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0);
    const meta = extractModuleMeta(ast);
    meta.imports["foo"].resolved = true;
    meta.imports["foo"].info = {
      kind: "func",
      signature: "i_i",
    } as any;
    const wat = emitModule(ast, meta).buildWat();
    assert(wat.includes('(import "mod" "foo" (func $foo (type $i_i_type)))'));
    assert(wat.includes("(type $i_i_type (func (param i32) (result i32)))"));
  });

  test("exported function appears in exports metadata", () => {
    const { meta } = compile("export fn test(): void {}");
    assert(meta.exports["test"] !== undefined);
    assert.equal(meta.exports["test"].kind, "func");
  });

  test("exported global appears in exports metadata", () => {
    const { meta } = compile("export let x: i32 = 0;");
    assert(meta.exports["x"] !== undefined);
    assert.equal(meta.exports["x"].kind, "global");
  });

  test("exported struct appears in exports", () => {
    const { meta } = compile("export struct Visible { x: i32 }");
    assert(meta.exports["Visible"] !== undefined);
    assert.equal(meta.exports["Visible"].kind, "struct");
  });

  test("non-exported struct does not appear in exports", () => {
    const { meta } = compile("struct Hidden { x: i32 }");
    assert.equal(meta.exports["Hidden"], undefined);
  });

  test("mixed exported and non-exported structs keep struct metadata but only export public", () => {
    const { meta } = compile("export struct Pub { x: i32 } struct Priv { y: f32 }");
    assert(meta.exports["Pub"] !== undefined);
    assert.equal(meta.exports["Priv"], undefined);
    assert(meta.structs["Pub"] !== undefined);
    assert(meta.structs["Priv"] !== undefined);
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
      }
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
