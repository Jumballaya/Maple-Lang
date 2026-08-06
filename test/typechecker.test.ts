import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { linkStdlibImports } from "../src/compiler/compiler";
import type { MapleError } from "../src/compiler/errors";
import { INTRINSICS } from "../src/compiler/intrinsics";
import { collectFnReferences, extractModuleMeta } from "../src/compiler/module-metadata";
import { typeCheck } from "../src/compiler/TypeChecker";
import { Parser } from "../src/parser/Parser";

function check(src: string): MapleError[] {
  const p = new Parser(src);
  const ast = p.parse("test");
  assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  const meta = extractModuleMeta(ast, true);
  collectFnReferences(ast, meta);
  linkStdlibImports(meta);
  return typeCheck(ast, meta);
}

function expectError(src: string, substring: string) {
  const errors = check(src);
  assert(
    errors.length > 0,
    `Expected at least one type error containing "${substring}", got 0 errors`,
  );
  assert(
    errors.some((e) => e.message.includes(substring)),
    `Expected error containing "${substring}", got: ${errors.map((e) => e.message).join("; ")}`,
  );
}

function expectNoErrors(src: string) {
  const errors = check(src);
  assert.equal(
    errors.length,
    0,
    `Expected 0 errors, got: ${errors.map((e) => e.message).join("; ")}`,
  );
}

function expectExactError(src: string, message: string) {
  const errors = check(src);
  assert(
    errors.some((error) => error.message === message),
    `Expected exact error "${message}", got: ${errors.map((error) => error.message).join("; ")}`,
  );
}

const intrinsicCases = [
  { name: "__load_i32", params: ["i32"], result: "i32", args: ["65536"] },
  { name: "__store_i32", params: ["i32", "i32"], result: "void", args: ["65536", "42"] },
  { name: "__memory_size", params: [], result: "i32", args: [] },
  { name: "__memory_grow", params: ["i32"], result: "i32", args: ["1"] },
  {
    name: "__memory_copy",
    params: ["i32", "i32", "i32"],
    result: "void",
    args: ["65544", "65536", "8"],
  },
  { name: "__trap", params: [], result: "void", args: [] },
  { name: "__sqrt_f32", params: ["f32"], result: "f32", args: ["16.0"] },
  { name: "__abs_f32", params: ["f32"], result: "f32", args: ["-3.0"] },
  { name: "__floor_f32", params: ["f32"], result: "f32", args: ["1.9"] },
  { name: "__ceil_f32", params: ["f32"], result: "f32", args: ["1.1"] },
  { name: "__nearest_f32", params: ["f32"], result: "f32", args: ["2.5"] },
  { name: "__trunc_f32", params: ["f32"], result: "f32", args: ["-1.9"] },
  {
    name: "__copysign_f32",
    params: ["f32", "f32"],
    result: "f32",
    args: ["3.0", "-1.0"],
  },
  { name: "__sqrt_f64", params: ["f64"], result: "f64", args: ["16.0 as f64"] },
  { name: "__abs_f64", params: ["f64"], result: "f64", args: ["-3.0 as f64"] },
  { name: "__floor_f64", params: ["f64"], result: "f64", args: ["1.9 as f64"] },
  { name: "__ceil_f64", params: ["f64"], result: "f64", args: ["1.1 as f64"] },
  { name: "__nearest_f64", params: ["f64"], result: "f64", args: ["2.5 as f64"] },
  { name: "__trunc_f64", params: ["f64"], result: "f64", args: ["-1.9 as f64"] },
  {
    name: "__copysign_f64",
    params: ["f64", "f64"],
    result: "f64",
    args: ["3.0 as f64", "-1.0 as f64"],
  },
] as const;

// ─── Check 1: Assignment type compatibility ──────────────────────────────────

describe("TypeChecker: Assignment compatibility", () => {
  test("i32 variable assigned f32 literal is an error", () => {
    expectError("fn f(): void { let x: i32 = 3.14; }", "Type mismatch");
  });

  test("f32 variable assigned i32 literal is an error", () => {
    expectError("fn f(): void { let x: f32 = 5; }", "Type mismatch");
  });

  test("i32 variable assigned i32 literal is ok", () => {
    expectNoErrors("fn f(): void { let x: i32 = 5; }");
  });

  test("i32 variable assigned bool literal is ok (bool compat with i32)", () => {
    expectNoErrors("fn f(): void { let x: i32 = true; }");
  });

  test("top-level global i32 assigned f32 is an error", () => {
    expectError("let g: i32 = 3.14;", "Type mismatch");
  });

  test("for-loop init let type mismatch is an error", () => {
    expectError("fn f(): void { for (let i: i32 = 1.5; i < 10; i = i + 1) { } }", "Type mismatch");
  });
});

// ─── Check 2: Function return type ───────────────────────────────────────────

describe("TypeChecker: Return type", () => {
  test("void function returning a value is an error", () => {
    expectError("fn f(): void { return 5; }", "void function");
  });

  test("i32 function with bare return is an error", () => {
    expectError("fn f(): i32 { return; }", "must return a value");
  });

  test("i32 function returning f32 is an error", () => {
    expectError("fn f(): i32 { return 3.14; }", "Return type mismatch");
  });

  test("i32 function returning i32 is ok", () => {
    expectNoErrors("fn f(): i32 { return 5; }");
  });

  test("void function with bare return is ok", () => {
    expectNoErrors("fn f(): void { return; }");
  });
});

describe("TypeChecker: integer literal ranges", () => {
  const rangeError = (type: string) => `integer literal out of range for type '${type}'`;

  for (const [name, source, type] of [
    ["i32 above maximum", "fn f(): i32 { return 2147483648; }", "i32"],
    ["i32 below minimum", "fn f(): i32 { return -2147483649; }", "i32"],
    ["u32 below minimum", "fn f(): u32 { return -1; }", "u32"],
    ["u32 above maximum", "fn f(): u32 { return 4294967296; }", "u32"],
    ["u8 above maximum", "fn f(): void { let x: u8 = 256; }", "u8"],
    ["i8 below minimum", "fn f(): void { let x: i8 = -129; }", "i8"],
    ["i64 above maximum", "fn f(): i64 { return 9223372036854775808; }", "i64"],
    ["i64 below minimum", "fn f(): i64 { return -9223372036854775809; }", "i64"],
    ["u64 below minimum", "fn f(): u64 { return -1; }", "u64"],
    ["u64 above maximum", "fn f(): u64 { return 18446744073709551616; }", "u64"],
  ] as const) {
    test(`${name} is rejected`, () => expectExactError(source, rangeError(type)));
  }

  test("all integer type boundaries are accepted", () => {
    expectNoErrors(`
      fn bounds(): void {
        let i8min: i8 = -128; let i8max: i8 = 127;
        let u8min: u8 = 0; let u8max: u8 = 255;
        let i16min: i16 = -32768; let i16max: i16 = 32767;
        let u16min: u16 = 0; let u16max: u16 = 65535;
        let i32min: i32 = -2147483648; let i32max: i32 = 2147483647;
        let u32min: u32 = 0; let u32max: u32 = 4294967295;
        let i64min: i64 = -9223372036854775808; let i64max: i64 = 9223372036854775807;
        let u64min: u64 = 0; let u64max: u64 = 18446744073709551615;
      }
    `);
  });

  test("call arguments use the parameter type", () => {
    expectError("fn take(x: u8): void {} fn f(): void { take(256); }", rangeError("u8"));
  });

  test("struct fields use the declared field type", () => {
    expectError("struct S { x: i8 } fn f(): void { let s: S = { x = 128 }; }", rangeError("i8"));
  });

  test("plain assignments use the target type", () => {
    expectExactError("fn f(): void { let x: i32 = 0; x = 2147483648; }", rangeError("i32"));
  });

  test("compound assignments use the target type", () => {
    expectExactError("fn f(): void { let x: i32 = 0; x += 2147483648; }", rangeError("i32"));
  });

  test("global initializers use the declared type", () => {
    expectError("let x: u8 = 256;", rangeError("u8"));
  });

  test("array elements use the array member type", () => {
    expectError("fn f(): void { let a: i32[] = [1, 2147483648999]; }", rangeError("i32"));
  });

  test("integer literals adopt an unsigned sibling's range", () => {
    expectNoErrors("fn f(x: u32): u32 { return x + 4000000000; }");
    expectError("fn f(x: u32): u32 { return x + (-1); }", rangeError("u32"));
  });

  test("context-free integer literals default to i32", () => {
    expectError("fn f(): void { 2147483648; }", rangeError("i32"));
  });

  test("direct literal casts are exempt from range validation", () => {
    expectNoErrors("fn a(): u32 { return -1 as u32; } fn b(): i32 { return 99999999999 as i32; }");
  });
});

describe("TypeChecker: array literal elements", () => {
  for (const [name, source] of [
    ["identifier", "fn f(x: i32): void { let a: i32[] = [x, 2]; }"],
    ["call", "fn value(x: i32): i32 { return x; } fn f(): void { let a: i32[] = [value(1)]; }"],
    ["infix expression", "fn f(): void { let a: i32[] = [1 + 2]; }"],
    ["postfix expression", "fn f(): void { let y: i32 = 1; let a: i32[] = [y++]; }"],
  ] as const) {
    test(`${name} elements use runtime initialization`, () => {
      expectNoErrors(source);
    });
  }

  test("incompatible elements are rejected", () => {
    expectExactError(
      'fn f(): void { let a: i32[] = [1, "x"]; }',
      "array element: expected 'i32', got 'string'",
    );
  });

  test("array member and literal types must agree", () => {
    expectExactError(
      "fn f(): void { let a: i32[] = [1.0, 2.0]; }",
      "array element: expected 'i32', got 'f32'",
    );
  });

  test("nested array literals are rejected temporarily", () => {
    expectExactError(
      "fn f(): void { let a: i32[][] = [[1], [2]]; }",
      "nested array literals are not supported yet",
    );
  });

  test("supported literal arrays type-check", () => {
    expectNoErrors(`
      fn f(): void {
        let ints: i32[] = [1, 2, 3];
        let strings: string[] = ["a", "b"];
        let bools: bool[] = [true, false];
        let empty: i32[] = [];
      }
    `);
  });

  test("integer and float literals adopt wider array member types", () => {
    expectNoErrors(`
      fn f(): void {
        let ints: i64[] = [1, 2];
        let floats: f64[] = [1.0, 2.0];
      }
    `);
  });
});

// ─── Check 3: Mixed binary operand types ─────────────────────────────────────

describe("TypeChecker: Mixed arithmetic", () => {
  test("f32 + i32 without cast is an error", () => {
    expectError("fn f(): void { let r: f32 = 1.0 + 2; }", "Mixed types");
  });

  test("f32 + f32 is ok", () => {
    expectNoErrors("fn f(): void { let r: f32 = 1.0 + 2.0; }");
  });

  test("i32 + i32 is ok", () => {
    expectNoErrors("fn f(): void { let r: i32 = 1 + 2; }");
  });

  test("cast to f32 then add f32 is ok", () => {
    expectNoErrors("fn f(): void { let r: f32 = 1 as f32 + 2.0; }");
  });
});

describe("TypeChecker: mixed integer signedness", () => {
  const mixed = (left: string, right: string) =>
    `mixed signedness: '${left}' and '${right}' - cast one operand explicitly`;

  for (const [name, source, left, right] of [
    ["i32 + u32", "fn f(a: i32, b: u32): i32 { return a + b; }", "i32", "u32"],
    ["u32 - i32", "fn f(a: u32, b: i32): i32 { return a - b; }", "u32", "i32"],
    ["i32 < u32", "fn f(a: i32, b: u32): i32 { return a < b; }", "i32", "u32"],
    ["u32 >= i32", "fn f(a: u32, b: i32): i32 { return a >= b; }", "u32", "i32"],
    ["u16 * i16", "fn f(a: u16, b: i16): i32 { return a * b; }", "u16", "i16"],
    ["u8 | i8", "fn f(a: u8, b: i8): i32 { return a | b; }", "u8", "i8"],
    ["u32 += i32", "fn f(): void { let a: u32 = 1; let b: i32 = 2; a += b; }", "u32", "i32"],
  ] as const) {
    test(`${name} requires an explicit cast`, () => {
      expectExactError(source, mixed(left, right));
    });
  }

  test("nested literal adoption still exposes a later signed operand", () => {
    expectExactError("fn f(u: u32, s: i32): i32 { return (1 + u) < s; }", mixed("u32", "i32"));
    expectExactError("fn f(u: u32, s: i32): i32 { return 1 + 2 + u < s; }", mixed("u32", "i32"));
  });

  test("comparisons reject mixed Wasm lanes", () => {
    expectError("fn f(a: i32, b: f32): i32 { return a < b; }", "Mixed types");
    expectError("fn f(a: f64, b: i64): i32 { return a == b; }", "Mixed types");
  });

  test("same-signedness operands and explicit casts are accepted", () => {
    expectNoErrors(`
      fn f(a: u32, b: u32, c: i32, d: i32, e: u8, g: u8): void {
        let r1: u32 = a + b;
        let r2: i32 = c - d;
        let r3: u32 = e | g;
        let r4: u32 = (c as u32) + b;
      }
    `);
  });

  test("equality permits same-lane signed and unsigned operands", () => {
    expectNoErrors("fn f(a: i32, b: u32): void { let eq: bool = a == b; let ne: bool = a != b; }");
  });

  test("unsigned operands adopt bare literals recursively", () => {
    expectNoErrors(`
      fn f(x: u32, y: u32): void {
        let a: u32 = x + 1;
        let b: u32 = 1 + x;
        let c: bool = x < 10;
        let d: u32 = 1 + 2 + x;
        let e: bool = (1 + x) < y;
      }
    `);
  });

  test("shift counts ignore signedness", () => {
    expectNoErrors("fn f(x: u32, s: i32): void { let l: u32 = x << s; let r: u32 = x >> s; }");
  });

  test("unary minus on unsigned values is legal", () => {
    expectNoErrors("fn f(u: u32): u32 { return -u; }");
  });

  test("existing cross-width arithmetic remains an error", () => {
    expectError("fn f(): void { let a: i32 = 1; let b: i64 = 2 as i64; a + b; }", "Mixed types");
  });
});

// ─── Check 4: Function call argument count and types ─────────────────────────

describe("TypeChecker: Call arguments", () => {
  test("too few arguments is an error", () => {
    expectError(
      "fn add(a: i32, b: i32): i32 { return a + b; }\nfn f(): void { add(1); }",
      "expects 2 arguments, got 1",
    );
  });

  test("too many arguments is an error", () => {
    expectError(
      "fn add(a: i32, b: i32): i32 { return a + b; }\nfn f(): void { add(1, 2, 3); }",
      "expects 2 arguments, got 3",
    );
  });

  test("wrong argument type is an error", () => {
    expectError(
      "fn add(a: i32, b: i32): i32 { return a + b; }\nfn f(): void { add(1, 2.0); }",
      "Type mismatch",
    );
  });

  test("correct argument count and types is ok", () => {
    expectNoErrors("fn add(a: i32, b: i32): i32 { return a + b; }\nfn f(): void { add(1, 2); }");
  });

  test("global initializer call with wrong arg count is an error", () => {
    expectError(
      "fn add(a: i32, b: i32): i32 { return a + b; }\nlet g: i32 = add(1);",
      "expects 2 arguments, got 1",
    );
  });
});

// ─── Check 5: Struct member existence ────────────────────────────────────────

describe("TypeChecker: Struct member existence", () => {
  test("accessing nonexistent member is an error", () => {
    expectError(
      "struct P { x: i32, y: i32, }\nfn f(): i32 { let p: P = { x = 1, y = 2 }; return p.z; }",
      "no member",
    );
  });

  test("accessing existing member is ok", () => {
    expectNoErrors(
      "struct P { x: i32, y: i32, }\nfn f(): i32 { let p: P = { x = 1, y = 2 }; return p.x; }",
    );
  });
});

// ─── Check 6: Const mutation ─────────────────────────────────────────────────

describe("TypeChecker: Const mutation", () => {
  test("assigning to a const variable is an error", () => {
    expectError("fn f(): void { const x: i32 = 5; x = 10; }", "Cannot assign to constant");
  });

  test("assigning to a let variable is ok", () => {
    expectNoErrors("fn f(): void { let x: i32 = 5; x = 10; }");
  });

  test("assigning through member on const binding is an error", () => {
    expectError(
      "struct P { x: i32, }\nfn f(): void { const p: P = { x = 1 }; p.x = 2; }",
      "Cannot assign to constant 'p'",
    );
  });

  test("assigning through index on const binding is an error", () => {
    expectError(
      "fn f(): void { const arr: i32[] = [1, 2, 3]; arr[0] = 9; }",
      "Cannot assign to constant 'arr'",
    );
  });
});

// ─── Full valid program ──────────────────────────────────────────────────────

describe("TypeChecker: Full program", () => {
  test("valid program with multiple functions, structs, and expressions has 0 errors", () => {
    expectNoErrors(`
struct Point {
  x: i32,
  y: i32,
}
fn sum(a: i32, b: i32): i32 {
  return a + b;
}
fn main(): i32 {
  let p: Point = { x = 3, y = 4 };
  let total: i32 = p.x + p.y;
  let half: i32 = (total as f32 * 0.5) as i32;
  return sum(total, half);
}
    `);
  });
});

describe("TypeChecker: Type inference integration", () => {
  test("inferred i32 prevents assignment to f32 local", () => {
    expectError(
      `fn f(): void {
        let x = 5;
        let y: f32 = x;
      }`,
      "Type mismatch",
    );
  });

  test("valid program with mix of inferred and explicit annotations", () => {
    expectNoErrors(`
struct Point {
  x: i32,
  y: i32,
}
fn add(a: i32, b: i32): i32 {
  return a + b;
}
fn main(): i32 {
  let a = 10;
  let b = 20;
  let sum: i32 = add(a, b);
  let ratio = sum as f32;
  let arr = [1, 2, 3];
  return sum;
}
    `);
  });
});

describe("TypeChecker: Strings", () => {
  test("string variable assigned string literal is ok", () => {
    expectNoErrors('fn f(): void { let s: string = "hello"; }');
  });

  test("i32 variable assigned string literal is an error", () => {
    expectError('fn f(): void { let x: i32 = "hello"; }', "Type mismatch");
  });

  test("string variable assigned i32 literal is an error", () => {
    expectError("fn f(): void { let s: string = 5; }", "Type mismatch");
  });

  test("string argument to string parameter is ok", () => {
    expectNoErrors('fn f(s: string): void {} fn g(): void { f("hello"); }');
  });

  test("string argument to i32 parameter is an error", () => {
    expectError('fn f(n: i32): void {} fn g(): void { f("hello"); }', "Type mismatch");
  });
});

describe("TypeChecker: Struct methods", () => {
  test("method receiver struct must exist", () => {
    expectError("fn Ghost.vanish(g)(): void {}", "Method declared on unknown struct 'Ghost'");
  });

  test("method call with receiver and args is type-checked as normal function call", () => {
    expectNoErrors(`
struct Vec2 {
  x: i32,
  y: i32,
}
fn Vec2.add(v)(other: Vec2): i32 {
  return v.x + other.x;
}
fn run(v: Vec2, other: Vec2): i32 {
  return v.add(other);
}
    `);
  });
});

// ─── Control flow ───────────────────────────────────────────────

describe("TypeChecker: Control Flow - Scope", () => {
  test("for loop variable is not visible after the loop", () => {
    // for-loop var is added to scope but never removed, so it leaks
    expectError(
      `fn f(): i32 {
        for (let i: i32 = 0; i < 5; i = i + 1) {}
        return i;
      }`,
      "i",
    );
  });

  test("for loop variable is visible inside the loop body", () => {
    // the variable must be accessible within the loop
    expectNoErrors(`
      fn f(): void {
        for (let i: i32 = 0; i < 5; i = i + 1) {
          let x: i32 = i;
        }
      }
    `);
  });

  test("two sequential for loops with same variable name do not conflict", () => {
    // each loop's scope is independent
    expectNoErrors(`
      fn f(): void {
        for (let i: i32 = 0; i < 3; i = i + 1) {}
        for (let i: i32 = 0; i < 5; i = i + 1) {}
      }
    `);
  });
});

describe("TypeChecker: Control Flow - Break/Continue Context", () => {
  test("break outside any loop or switch is a type error", () => {
    // no context validation exists yet
    expectError("fn f(): void { break; }", "break");
  });

  test("continue outside any loop is a type error", () => {
    // no context validation exists yet
    expectError("fn f(): void { continue; }", "continue");
  });

  test("continue inside switch but not inside a loop is a type error", () => {
    // continue should only be valid in loops, not bare switches
    expectError(
      `fn f(x: i32): void { switch (x) { case 0: { continue; } default: { break; } } }`,
      "continue",
    );
  });

  test("break inside for loop is valid", () => {
    expectNoErrors("fn f(): void { for (let i: i32 = 0; i < 5; i = i + 1) { break; } }");
  });

  test("continue inside for loop is valid", () => {
    expectNoErrors("fn f(): void { for (let i: i32 = 0; i < 5; i = i + 1) { continue; } }");
  });

  test("break inside while loop is valid", () => {
    expectNoErrors("fn f(): void { while (1) { break; } }");
  });

  test("continue inside while loop is valid", () => {
    expectNoErrors("fn f(): void { let i: i32 = 0; while (i < 5) { i = i + 1; continue; } }");
  });

  test("break inside switch is valid", () => {
    //
    expectNoErrors(`fn f(x: i32): void { switch (x) { case 0: { break; } default: { break; } } }`);
  });

  test("continue inside switch inside for loop is valid (targets the loop)", () => {
    // continue in a switch that is inside a loop should be allowed
    expectNoErrors(`
      fn f(x: i32): void {
        for (let i: i32 = 0; i < 5; i = i + 1) {
          switch (x) {
            case 0: { continue; }
            default: { break; }
          }
        }
      }
    `);
  });

  test("break inside nested for loops is valid", () => {
    expectNoErrors(`
      fn f(): void {
        for (let i: i32 = 0; i < 3; i = i + 1) {
          for (let j: i32 = 0; j < 3; j = j + 1) {
            break;
          }
        }
      }
    `);
  });
});

describe("TypeChecker: If conditions", () => {
  test("if with void call condition is a type error", () => {
    expectError(
      `
      fn noop(): void {}
      fn f(): void {
        if (noop()) { return; }
      }
      `,
      "if condition",
    );
  });
});

// ─── Memory-Backed Local Structs — Type Checker ──────────────────────────

describe("TypeChecker: Local struct member access", () => {
  test("accessing i32 member on local struct reports no error", () => {
    expectNoErrors(`
      struct Point { x: i32, y: i32 }
      fn f(): i32 {
        let p: Point = { x = 3, y = 4 };
        return p.x;
      }
    `);
  });

  test("accessing f32 member on local struct reports no error", () => {
    expectNoErrors(`
      struct Vec2 { x: f32, y: f32 }
      fn f(): f32 {
        let v: Vec2 = { x = 1.5, y = 2.5 };
        return v.x;
      }
    `);
  });

  test("p.x + p.y type-checks correctly as i32", () => {
    expectNoErrors(`
      struct Point { x: i32, y: i32 }
      fn f(): i32 {
        let p: Point = { x = 3, y = 4 };
        return p.x + p.y;
      }
    `);
  });

  test("method call on local struct reports no error", () => {
    expectNoErrors(`
      struct Point { x: i32, y: i32 }
      fn Point.sum(p)(): i32 { return p.x + p.y; }
      fn f(): i32 {
        let p: Point = { x = 3, y = 4 };
        return p.sum();
      }
    `);
  });

  test("method call with wrong arg count on local struct still reports error", () => {
    expectError(
      `
      struct Point { x: i32, y: i32 }
      fn Point.scale(self)(factor: i32): i32 { return self.x * factor; }
      fn f(): i32 {
        let p: Point = { x = 3, y = 4 };
        return p.scale(2, 3);
      }
      `,
      "expects",
    );
  });

  test("accessing nonexistent member on local struct still caught", () => {
    expectError(
      `
      struct Point { x: i32, y: i32 }
      fn f(): i32 {
        let p: Point = { x = 1, y = 2 };
        return p.z;
      }
      `,
      "no member",
    );
  });
});

describe("TypeChecker: Struct literal field validation", () => {
  test("extra field in struct literal is an error", () => {
    expectError(
      `
      struct Point { x: i32, y: i32 }
      fn f(): void { let p: Point = { x = 1, y = 2, z = 3 }; }
      `,
      "has no field 'z'",
    );
  });

  test("missing field in struct literal is an error", () => {
    expectError(
      `
      struct Point { x: i32, y: i32 }
      fn f(): void { let p: Point = { x = 1 }; }
      `,
      "field 'y' is not initialized",
    );
  });

  test("unknown and missing fields are both reported", () => {
    const errors = check(`
      struct Point { x: i32, y: i32 }
      fn f(): void { let p: Point = { x = 1, w = 9 }; }
    `);
    const joined = errors.map((e) => e.message).join("\n");
    assert(joined.includes("has no field 'w'"), `Missing unknown-field error:\n${joined}`);
    assert(
      joined.includes("field 'y' is not initialized"),
      `Missing missing-field error:\n${joined}`,
    );
  });

  test("f32 assigned to i32 struct field is an error", () => {
    expectError(
      `
      struct Point { x: i32, y: i32 }
      fn f(): void { let p: Point = { x = 3.14, y = 2 }; }
      `,
      "expected 'i32', got 'f32'",
    );
  });

  test("i32 assigned to f32 struct field is an error", () => {
    expectError(
      `
      struct Vec2 { x: f32, y: f32 }
      fn f(): void { let v: Vec2 = { x = 1, y = 2.0 }; }
      `,
      "expected 'f32', got 'i32'",
    );
  });

  test("undefined identifier inside struct field expression is an error", () => {
    expectError(
      `
      struct Point { x: i32, y: i32 }
      fn f(): void { let p: Point = { x = doesNotExist, y = 0 }; }
      `,
      "Undefined identifier",
    );
  });

  test("wrong function argument count in field expression is an error", () => {
    expectError(
      `
      struct Point { x: i32, y: i32 }
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn f(): void { let p: Point = { x = add(1), y = 0 }; }
      `,
      "expects 2 arguments",
    );
  });

  test("mixed arithmetic in field expression is an error", () => {
    expectError(
      `
      struct Point { x: i32, y: i32 }
      fn f(): void {
        let i: i32 = 1;
        let n: f32 = 2.0;
        let p: Point = { x = i + n, y = 0 };
      }
      `,
      "Mixed types in arithmetic",
    );
  });

  test("valid expression-valued fields type-check successfully", () => {
    expectNoErrors(`
      struct Point { x: i32, y: i32 }
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn f(): i32 {
        let a: i32 = 2;
        let b: i32 = 3;
        let p: Point = { x = add(a, b), y = a + 1 };
        return p.x + p.y;
      }
    `);
  });

  test("global struct missing field is caught before emission", () => {
    expectError(
      `
      struct Point { x: i32, y: i32 }
      let g: Point = { x = 1 };
      `,
      "field 'y' is not initialized",
    );
  });

  test("global struct extra field is caught before emission", () => {
    expectError(
      `
      struct Point { x: i32, y: i32 }
      let g: Point = { x = 1, y = 2, z = 3 };
      `,
      "has no field 'z'",
    );
  });

  test("member expression from i32 struct into f32 struct fields reports type errors", () => {
    const errors = check(`
      struct Point { x: i32, y: i32 }
      struct Vec2 { x: f32, y: f32 }
      fn f(): void {
        let other: Point = { x = 1, y = 2 };
        let v: Vec2 = { x = other.x, y = other.y };
      }
    `);
    const msg = errors.map((e) => e.message).join("\n");
    assert(msg.includes("field 'x': expected 'f32', got 'i32'"), `Missing x mismatch:\n${msg}`);
    assert(msg.includes("field 'y': expected 'f32', got 'i32'"), `Missing y mismatch:\n${msg}`);
  });
});

describe("TypeChecker: inferred call return types", () => {
  test("inferred i32 from call is type-checked against usage", () => {
    const src = `
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn f(): void {
        let x = add(1, 2);
        let y: i32 = x + 1;
      }
    `;
    expectNoErrors(src);
  });

  test("inferred i32 from call used in f32 context without cast is mixed-type error", () => {
    const src = `
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn f(): void {
        let x = add(1, 2);
        let y: f32 = x + 1.0;
      }
    `;
    expectError(src, "Mixed types");
  });

  test("inferred struct type from call allows member access", () => {
    const src = `
      struct P { x: i32, y: i32, }
      let zero: P = { x = 0, y = 0 };
      fn origin(): P { return zero; }
      fn f(): void {
        let o = origin();
        let v: i32 = o.x;
      }
    `;
    expectNoErrors(src);
  });

  test("inferred struct type from call catches nonexistent member", () => {
    const src = `
      struct P { x: i32, y: i32, }
      fn origin(): P { let p: P = { x = 0, y = 0 }; return p; }
      fn f(): i32 {
        let o = origin();
        return o.z;
      }
    `;
    expectError(src, "no member");
  });
});

describe("TypeChecker: multi-return and destructuring", () => {
  test("multi-return happy path", () => {
    expectNoErrors("fn f(): (i32, i32) { return 1, 2; }");
  });

  test("three-return happy path", () => {
    expectNoErrors("fn f(): (i32, i32, i32) { return 1, 2, 3; }");
  });

  test("five-return happy path", () => {
    expectNoErrors("fn f(): (i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5; }");
  });

  test("six-return happy path", () => {
    expectNoErrors("fn f(): (i32, i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5, 6; }");
  });

  test("multi-return arity mismatch", () => {
    expectError("fn f(): (i32, i32) { return 1; }", "Return arity mismatch");
  });

  test("single-return cannot return multi values", () => {
    expectError("fn f(): i32 { return 1, 2; }", "Return arity mismatch");
  });

  test("multi-return rejects bare return", () => {
    expectError("fn f(): (i32, i32) { return; }", "multi-return function cannot use a void return");
  });

  test("void function rejects multi-value return", () => {
    expectError("fn f(): void { return 1, 2; }", "Cannot return a value from a void function");
  });

  test("multi-return per-position mismatch", () => {
    expectError(
      "fn f(): (i32, i64) { let x: i32 = 2; return 1, x; }",
      "Return type mismatch at position 1",
    );
  });

  test("pass-through return happy path", () => {
    expectNoErrors(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): (i32, i32) { return swap(1, 2); }
    `);
  });

  test("pass-through return arity mismatch", () => {
    expectError(
      `
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): (i32, i32, i32) { return swap(1, 2); }
      `,
      "pass-through return arity mismatch",
    );
  });

  test("destructuring let happy path", () => {
    expectNoErrors(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): void { let (x, y) = swap(1, 2); let z: i32 = x + y; }
    `);
  });

  test("destructuring let with discards", () => {
    expectNoErrors(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): void { let (_, y) = swap(1, 2); let z: i32 = y; }
    `);
  });

  test("destructuring three-return happy path", () => {
    expectNoErrors(`
      fn tri(): (i32, i32, i32) { return 1, 2, 3; }
      fn f(): void { let (a, b, c) = tri(); let z: i32 = a + b + c; }
    `);
  });

  test("destructuring five-return with discard happy path", () => {
    expectNoErrors(`
      fn many(): (i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5; }
      fn f(): void { let (a, _, c, d, e) = many(); let z: i32 = a + c + d + e; }
    `);
  });

  test("destructure five-return arity mismatch", () => {
    expectError(
      `
      fn many(): (i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5; }
      fn f(): void { let (a, b, c, d) = many(); }
      `,
      "destructure arity mismatch",
    );
  });

  test("destructure rhs must be multi-return call", () => {
    expectError(
      `
      fn single(): i32 { return 1; }
      fn f(): void { let (x, y) = single(); }
      `,
      "destructure RHS must be a multi-return call",
    );
  });

  test("destructure arity mismatch", () => {
    expectError(
      `
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): void { let (x, y, z) = swap(1, 2); }
      `,
      "destructure arity mismatch",
    );
  });

  test("multi-return call cannot be assigned to single binding", () => {
    expectError(
      `
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): void { let x: i32 = swap(1, 2); }
      `,
      "multi-return value cannot be used as a single value",
    );
  });

  test("multi-return call cannot be used in arithmetic", () => {
    expectError(
      `
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): void { let z: i32 = swap(1, 2) + 1; }
      `,
      "multi-return value cannot be used as a single value",
    );
  });

  test("multi-return call cannot be used as if condition", () => {
    expectError(
      `
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): void { if (swap(1, 2)) {} }
      `,
      "multi-return value cannot be used as a single value",
    );
  });

  test("statement-position multi-return call is allowed", () => {
    expectNoErrors(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): void { swap(1, 2); }
    `);
  });

  test("top-level destructuring let is rejected", () => {
    const src = `
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      let (x, y) = swap(1, 2);
    `;
    const p = new Parser(src);
    p.parse("test");
    assert.equal(p.errors.length, 1);
    assert(p.errors[0]?.message.includes("top-level destructuring let is not supported"));
  });
});

describe("TypeChecker: function types", () => {
  test("same canonical fn-types are compatible", () => {
    expectNoErrors("fn run(cb: fn(i32):i32): void { let local: fn(i32):i32 = cb; }");
  });

  test("different arity fn-types are incompatible", () => {
    const errors = check("fn run(cb: fn(i32):i32): void { let local: fn(i32, i32):i32 = cb; }");
    assert(errors.length > 0);
    assert(errors.some((e) => e.message.includes("Type mismatch")));
    assert(errors.some((e) => e.message.includes("fn(i32):i32")));
    assert(errors.some((e) => e.message.includes("fn(i32,i32):i32")));
  });

  test("differing param types make fn-types incompatible", () => {
    const errors = check("fn run(cb: fn(i32):i32): void { let local: fn(f32):i32 = cb; }");
    assert(errors.some((e) => e.message.includes("Type mismatch")));
  });

  test("differing return types make fn-types incompatible", () => {
    const errors = check("fn run(cb: fn(i32):i32): void { let local: fn(i32):f32 = cb; }");
    assert(errors.some((e) => e.message.includes("Type mismatch")));
  });

  test("single-return vs multi-return fn-types are incompatible", () => {
    const errors = check("fn run(cb: fn(i32):i32): void { let local: fn(i32):(i32, i32) = cb; }");
    assert(errors.some((e) => e.message.includes("Type mismatch")));
  });

  test("void vs value return fn-types are incompatible", () => {
    const errors = check("fn run(cb: fn(i32):void): void { let local: fn(i32):i32 = cb; }");
    assert(errors.some((e) => e.message.includes("Type mismatch")));
  });

  test("fn-typed value rejected as if condition", () => {
    expectError(
      "fn run(cb: fn(i32):i32): void { if (cb) {} }",
      "fn-typed value is not a valid condition",
    );
  });

  test("cannot assign fn-typed value to i32 slot", () => {
    expectError(
      "fn run(cb: fn(i32):i32): void { let n: i32 = cb; }",
      "Type mismatch: cannot assign 'fn(i32):i32' to 'i32'",
    );
  });

  test("naming a function as value", () => {
    const errors = check(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): void { let op: fn(i32,i32):i32 = add; }
    `);
    assert.equal(
      errors.length,
      0,
      `Expected 0 errors, got: ${errors.map((e) => e.message).join("; ")}`,
    );
    const p = new Parser(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): void { let op: fn(i32,i32):i32 = add; }
    `);
    const ast = p.parse("test");
    const meta = extractModuleMeta(ast);
    collectFnReferences(ast, meta);
    linkStdlibImports(meta);
    assert(meta.fnTable.has("add"), "add should be in fnTable");
    const entry = meta.fnTable.get("add")!;
    assert.equal(entry.signatureKey, "fn(i32,i32):i32");
  });

  test("rejects top-level let with fn-type annotation (parser)", () => {
    const p = new Parser("let g: fn(i32):i32 = 0;");
    p.parse("test");
    assert(
      p.errors.some((e) =>
        e.message.includes("fn-typed bindings are not allowed at module scope yet"),
      ),
    );
  });

  test("rejects top-level const with fn-type annotation (parser)", () => {
    const p = new Parser("const g: fn(i32):i32 = 0;");
    p.parse("test");
    assert(
      p.errors.some((e) =>
        e.message.includes("fn-typed bindings are not allowed at module scope yet"),
      ),
    );
  });
});

describe("TypeChecker: named function references", () => {
  test("function name in scope has canonical fn-type", () => {
    const p = new Parser(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): void { let op: fn(i32,i32):i32 = add; }
    `);
    const ast = p.parse("test");
    const meta = extractModuleMeta(ast);
    collectFnReferences(ast, meta);
    linkStdlibImports(meta);
    const errors = typeCheck(ast, meta);
    assert.equal(errors.length, 0, errors.map((e) => e.message).join("; "));
  });

  test("fn-type mismatch when assigning wrong function", () => {
    expectError(
      `
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn sub(a: f32): f32 { return a; }
      fn outer(): void { let op: fn(i32,i32):i32 = sub; }
      `,
      "Type mismatch",
    );
  });

  test("indirect call through fn-typed variable type-checks", () => {
    expectNoErrors(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): i32 {
        let op: fn(i32,i32):i32 = add;
        return op(1, 2);
      }
    `);
  });

  test("indirect call arg count mismatch is an error", () => {
    expectError(
      `
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn outer(): i32 {
        let op: fn(i32,i32):i32 = add;
        return op(1);
      }
      `,
      "expects 2 arguments, got 1",
    );
  });

  test("non-callable variable error", () => {
    expectError(`fn outer(): i32 { let x: i32 = 5; return x(1); }`, "'x' is not callable");
  });

  test("cannot take reference to _start", () => {
    expectError(
      `
      fn _start(): void {}
      fn outer(): void { let op: fn():void = _start; }
      `,
      "cannot take a reference to '_start'",
    );
  });

  test("cannot take reference to imported function", () => {
    expectError(
      `
      import malloc from "memory"
      fn outer(): void { let op: fn(i32):i32 = malloc; }
      `,
      "cannot take a reference to imported function 'malloc'",
    );
  });

  test("void function reference has fn():void type", () => {
    expectNoErrors(`
      fn noop(): void {}
      fn outer(): void {
        let cb: fn():void = noop;
      }
    `);
  });

  test("multi-return function reference type", () => {
    expectNoErrors(`
      fn pair(): (i32, i32) { return 1, 2; }
      fn outer(): void {
        let cb: fn():(i32,i32) = pair;
      }
    `);
  });

  test("getCallReturnTypes resolves through fn-typed variable for pass-through", () => {
    expectNoErrors(`
      fn pair(): (i32, i32) { return 1, 2; }
      fn forward(op: fn():(i32,i32)): (i32, i32) {
        return op();
      }
    `);
  });
});

describe("TypeChecker: imported stdlib globals", () => {
  test("imported f32 global used as return value type-checks", () => {
    expectNoErrors(`
      import PI from "math"
      fn f(): f32 { return PI; }
    `);
  });

  test("cannot assign to imported global", () => {
    expectError(
      `
      import PI from "math"
      fn f(): void { PI = 1.0; }
    `,
      "cannot assign to imported global",
    );
  });

  test("imported f32 global mismatched with i32 return is an error", () => {
    expectError(
      `
      import PI from "math"
      fn f(): i32 { return PI; }
    `,
      "Return type mismatch",
    );
  });
});

describe("TypeChecker: compiler intrinsics", () => {
  test("the intrinsic table contains exactly the specified signatures", () => {
    assert.deepEqual(
      Object.entries(INTRINSICS).map(([name, definition]) => ({
        name,
        params: definition.params,
        result: definition.result,
      })),
      intrinsicCases.map(({ name, params, result }) => ({ name, params, result })),
    );
  });

  for (const intrinsic of intrinsicCases) {
    test(`${intrinsic.name} accepts its declared signature`, () => {
      const call = `${intrinsic.name}(${intrinsic.args.join(", ")})`;
      const statement =
        intrinsic.result === "void" ? `${call};` : `let value: ${intrinsic.result} = ${call};`;
      expectNoErrors(`fn run(): void { ${statement} }`);
    });
  }

  for (const [name, wrongArity, wrongType] of [
    ["__load_i32", "__load_i32()", "__load_i32(1.0)"],
    ["__store_i32", "__store_i32(1)", "__store_i32(1, 2.0)"],
    ["__sqrt_f32", "__sqrt_f32()", "__sqrt_f32(1)"],
  ] as const) {
    test(`${name} rejects wrong arity`, () => {
      expectError(`fn run(): void { ${wrongArity}; }`, "expects");
    });

    test(`${name} rejects wrong argument types`, () => {
      expectError(`fn run(): void { ${wrongType}; }`, "Type mismatch");
    });
  }

  test("intrinsics cannot be used as function values", () => {
    expectError(
      "fn run(): void { let operation = __sqrt_f32; }",
      "cannot take a reference to intrinsic '__sqrt_f32'",
    );
  });

  for (const source of [
    'import __load_i32 from "memory"',
    "fn __load_i32(addr: i32): i32 { return addr; }",
  ]) {
    test(`${source.split(" ").slice(0, 2).join(" ")} is reserved`, () => {
      const parser = new Parser(source);
      parser.parse("test");
      assert(
        parser.errors.some((error) => error.message.includes("reserved")),
        parser.errors.map((error) => error.message).join("; "),
      );
    });
  }
});

// T58 — the cast matrix (ledger B26, decision O8). The rule is ASYMMETRIC:
// `i32 as Struct` is the allocation idiom and survives; every other struct
// direction reinterprets memory. Before this task NONE of these were rejected.
describe("TypeChecker: cast matrix", () => {
  const STRUCTS = "struct Cell { value: i32 } struct Other { value: i32 }";

  function inRun(body: string): string {
    return `${STRUCTS} fn make(): i32 { return 65536; } export fn run(): i32 { ${body} return 0; }`;
  }

  test("i32 as Struct stays legal — the allocation idiom", () => {
    expectNoErrors(inRun("let c: Cell = make() as Cell; c.value = 1;"));
  });

  test("the null idiom 0 as Struct stays legal", () => {
    expectNoErrors(inRun("let c: Cell = 0 as Cell;"));
  });

  // `as fn(...)` never reaches the checker: the parser rejects fn-type casts.
  for (const target of ["i32", "string", "i32[]", "Other", "Cell"]) {
    test(`Struct as ${target} is rejected (D8a)`, () => {
      expectExactError(
        inRun(`let c: Cell = make() as Cell; let x: ${target} = c as ${target};`),
        "cannot cast a struct value",
      );
    });
  }

  for (const source of ["f64", "i64", "bool"]) {
    test(`${source} as Struct is rejected (D8b)`, () => {
      expectExactError(
        inRun(`let v: ${source} = ${source === "bool" ? "true" : "1"}; let c: Cell = v as Cell;`),
        `cannot cast '${source}' to a struct type`,
      );
    });
  }

  test("string as Struct is rejected (D8b)", () => {
    expectExactError(
      inRun('let s: string = "x"; let c: Cell = s as Cell;'),
      "cannot cast 'string' to a struct type",
    );
  });

  test("an array as Struct is rejected (D8b)", () => {
    expectExactError(
      inRun("let a: i32[] = [1, 2]; let c: Cell = a as Cell;"),
      "cannot cast 'i32[]' to a struct type",
    );
  });

  test("two-hop laundering fails at the second hop", () => {
    expectExactError(
      inRun("let raw: i32 = (make() as Cell) as i32;"),
      "cannot cast a struct value",
    );
  });

  // Reinterpretation one category over: same hole, no struct involved.
  test("string as an array is rejected", () => {
    expectExactError(
      inRun('let s: string = "x"; let a: i32[] = s as i32[];'),
      "cannot cast 'string' to 'i32[]'",
    );
  });

  test("an array as string is rejected", () => {
    expectExactError(
      inRun("let a: i32[] = [1, 2]; let s: string = a as string;"),
      "cannot cast 'i32[]' to 'string'",
    );
  });

  // Regressions the repo asserted nowhere before this task.
  test("i32 as string is rejected", () => {
    expectExactError(inRun("let s: string = make() as string;"), "cannot cast 'i32' to 'string'");
  });

  test("i32 as an array is rejected", () => {
    expectExactError(inRun("let a: i32[] = make() as i32[];"), "cannot cast 'i32' to 'i32[]'");
  });

  test("numeric casts are untouched", () => {
    expectNoErrors(inRun("let f: f32 = 1.5; let i: i32 = f as i32; let back: f64 = i as f64;"));
  });
});

// T59 — `.len`/`.data` are read-only (ledger B24). The bounds check reads
// them, so `xs.len = 1000; xs[500]` returned 0 instead of trapping.
describe("TypeChecker: header fields are read-only", () => {
  const withArray = (body: string) =>
    `export fn run(): i32 { let a: i32[] = [1, 2]; ${body} return 0; }`;
  const withString = (body: string) =>
    `export fn run(): i32 { let s: string = "hi"; ${body} return 0; }`;

  for (const member of ["len", "data"]) {
    test(`an array's .${member} rejects plain assignment`, () => {
      expectExactError(withArray(`a.${member} = 9;`), `cannot assign to 'a.${member}'`);
    });

    test(`a string's .${member} rejects plain assignment`, () => {
      expectExactError(withString(`s.${member} = 9;`), `cannot assign to 's.${member}'`);
    });

    test(`an array's .${member} rejects compound assignment`, () => {
      expectExactError(withArray(`a.${member} += 1;`), `cannot assign to 'a.${member}'`);
      expectExactError(withArray(`a.${member} <<= 1;`), `cannot assign to 'a.${member}'`);
    });

    // The arm a `=`-only fix leaves as a working exploit.
    test(`an array's .${member} rejects increment and decrement`, () => {
      expectExactError(withArray(`a.${member}++;`), `cannot assign to 'a.${member}'`);
      expectExactError(withArray(`a.${member}--;`), `cannot assign to 'a.${member}'`);
    });
  }

  test("reads still work", () => {
    expectNoErrors(withArray("let n: i32 = a.len; let d: i32 = a.data; let m: i32 = n + d;"));
    expectNoErrors(withString("let n: i32 = s.len + s.data;"));
  });

  test("a user struct with its own len member stays writable", () => {
    expectNoErrors(
      "struct Row { len: i32, data: i32 } export fn run(): i32 { let r: Row = { len = 1, data = 2 }; r.len = 3; r.data = 4; r.len++; return r.len; }",
    );
  });

  test("a nested array member reports through its type", () => {
    expectExactError(
      "struct Holder { values: i32[] } export fn run(): i32 { let h: Holder = { values = [1, 2] }; h.values.len = 9; return 0; }",
      "cannot assign to 'i32[].len'",
    );
  });
});

// T61 — ledger B28. This spelling parsed, type-checked, then ICEd in lowering
// with `lowering: unsupported Identifier` — no line, no column, no message.
describe("TypeChecker: array-of-fn-ref near miss", () => {
  const ADD = "fn add(a: i32, b: i32): i32 { return a + b; }";

  test("the near-miss spelling produces a diagnostic, not a crash", () => {
    expectExactError(
      `${ADD} export fn run(): i32 { let ops: fn(i32,i32): i32[] = [add]; return 1; }`,
      "array of function references is not supported",
    );
  });

  test("an ordinary fn-ref binding still works", () => {
    expectNoErrors(
      `${ADD} export fn run(): i32 { let op: fn(i32,i32): i32 = add; return op(1, 2); }`,
    );
  });

  // The meaning the spelling actually has, and the regression a careless fix causes.
  test("a function returning an array still works", () => {
    expectNoErrors(
      "fn vals(): i32[] { return [1, 2]; } export fn run(): i32 { let v: i32[] = vals(); return v.len; }",
    );
  });

  test("a fn-typed binding initialized from another binding still works", () => {
    expectNoErrors(
      `${ADD} export fn run(): i32 { let first: fn(i32,i32): i32 = add; let second: fn(i32,i32): i32 = first; return second(1, 2); }`,
    );
  });
});

// T64 — the escape rule (ledger B25). Struct values ARE `$__sp`-relative
// pointers and `lowerReturn` releases the frame BEFORE handing one out, so
// every route below returned a sibling call's data.
describe("TypeChecker: frame-backed escapes", () => {
  const POINT = "struct Point { x: i32, y: i32 }";

  // The one that proves the rule is not syntactic. Assignment ALIASES (O4),
  // so `q` names `p`'s storage and a rule reading initializer syntax sees
  // nothing wrong here.
  test("an aliased frame struct is still rejected on return", () => {
    expectExactError(
      `${POINT} fn leak(): Point { let p: Point = { x = 1, y = 2 }; let q: Point = p; return q; }`,
      "cannot return a frame-backed value",
    );
  });

  test("mutually referential bindings converge and are rejected", () => {
    expectExactError(
      `${POINT} fn leak(): Point { let p: Point = { x = 1, y = 2 }; let q: Point = p; p = q; return q; }`,
      "cannot return a frame-backed value",
    );
  });

  test("returning a local struct literal is rejected (D5)", () => {
    expectExactError(
      `${POINT} fn make(a: i32): Point { let p: Point = { x = a, y = 0 }; return p; }`,
      "cannot return a frame-backed value",
    );
  });

  test("a multi-return slot is rejected (D5)", () => {
    expectExactError(
      `${POINT} fn make(): (i32, Point) { let p: Point = { x = 1, y = 2 }; return 1, p; }`,
      "cannot return a frame-backed value",
    );
  });

  test("storing into a global is rejected (D6)", () => {
    expectExactError(
      `${POINT} let g: Point = { x = 0, y = 0 }; fn stash(): void { let p: Point = { x = 7, y = 8 }; g = p; }`,
      "cannot store a frame-backed value in a global",
    );
  });

  test("storing into a struct field is rejected (D7)", () => {
    expectExactError(
      `${POINT} struct Holder { inner: Point } fn stash(h: Holder): void { let p: Point = { x = 7, y = 8 }; h.inner = p; }`,
      "cannot store a frame-backed value",
    );
  });

  test("storing into an array element is rejected (D7)", () => {
    expectExactError(
      `${POINT} fn stash(t: Point[]): void { let p: Point = { x = 7, y = 8 }; t[0] = p; }`,
      "cannot store a frame-backed value",
    );
  });

  // Ledger B27 closes here: the loop-slot miscompile is only observable
  // through a store the rule now rejects, so the shape is uncompilable.
  test("a loop-local struct stored into longer-lived storage is rejected", () => {
    expectExactError(
      `${POINT} fn fill(t: Point[]): void { for (let i: i32 = 0; i < 3; i = i + 1) { let p: Point = { x = i, y = 0 }; t[i] = p; } }`,
      "cannot store a frame-backed value",
    );
  });

  // The constructor idiom — not a literal, so not frame-backed.
  test("returning a heap struct stays legal", () => {
    expectNoErrors(
      `${POINT} fn alloc(n: i32): i32 { return 65536; } fn make(a: i32): Point { let p: Point = alloc(8) as Point; p.x = a; p.y = 0; return p; }`,
    );
  });

  test("aggregates are recorded but never rejected", () => {
    expectNoErrors("fn values(): i32[] { let v: i32[] = [7, 8]; return v; }");
    expectNoErrors('fn text(): string { let s: string = "hello"; return s; }');
    expectNoErrors("fn values(): i32[] { return [7, 8]; }");
  });

  test("a frame struct used locally is untouched", () => {
    expectNoErrors(
      `${POINT} fn use(p: Point): i32 { return p.x; } fn run(): i32 { let p: Point = { x = 1, y = 2 }; p.x = 5; return use(p) + p.y; }`,
    );
  });

  // The transitive case the analysis does NOT catch: covered by the borrow
  // convention, not by summaries (decision O1). This test exists so nobody
  // "fixes" it by marking parameters frame-backed — that would reject every
  // legitimate `g = <heap pointer parameter>`.
  test("a callee storing a PARAMETER into a global still compiles", () => {
    expectNoErrors(`${POINT} let g: Point = { x = 0, y = 0 }; fn keep(p: Point): void { g = p; }`);
  });
});

// T69 — `free` accepts structs (forced by decision O8: `free(p as i32)` is no
// longer expressible), plus the compile-time guards D3/D4 in front of the
// runtime region guard.
describe("TypeChecker: free accepts struct pointers", () => {
  const SETUP = 'import malloc, free, realloc from "memory"\nstruct Cell { value: i32 }\n';

  test("freeing a heap struct type-checks", () => {
    expectNoErrors(`${SETUP} fn run(): void { let c: Cell = malloc(8) as Cell; free(c); }`);
  });

  test("the null idiom is accepted", () => {
    expectNoErrors(`${SETUP} fn run(): void { free(0 as Cell); }`);
  });

  test("realloc takes a struct too", () => {
    expectNoErrors(
      `${SETUP} fn run(): i32 { let c: Cell = malloc(8) as Cell; let g: Cell = realloc(c, 32) as Cell; return g.value; }`,
    );
  });

  test("freeing a frame-backed struct is rejected (D3)", () => {
    expectExactError(
      `${SETUP} fn run(): void { let c: Cell = { value = 1 }; free(c); }`,
      "cannot free a frame-backed value",
    );
  });

  // The case a check reading only the operand's own declaration would miss.
  test("D3 fires through an alias", () => {
    expectExactError(
      `${SETUP} fn run(): void { let c: Cell = { value = 1 }; let alias: Cell = c; free(alias); }`,
      "cannot free a frame-backed value",
    );
  });

  test("freeing a module-scope literal binding is rejected (D4)", () => {
    expectExactError(
      `${SETUP} let shared: Cell = { value = 1 }; fn run(): void { free(shared); }`,
      "cannot free a static value",
    );
  });

  test("D4 fires through an alias", () => {
    expectExactError(
      `${SETUP} let shared: Cell = { value = 1 }; fn run(): void { let alias: Cell = shared; free(alias); }`,
      "cannot free a static value",
    );
  });

  test("the rule does not widen to strings or arrays", () => {
    expectError(
      `${SETUP} fn run(): void { let s: string = "x"; free(s); }`,
      "Type mismatch in argument 1",
    );
    expectError(
      `${SETUP} fn run(): void { let a: i32[] = [1]; free(a); }`,
      "Type mismatch in argument 1",
    );
  });

  test("the rule is scoped to the allocator, not to i32 parameters generally", () => {
    expectError(
      `${SETUP} fn mine(p: i32): void {} fn run(): void { let c: Cell = malloc(8) as Cell; mine(c); }`,
      "Type mismatch in argument 1",
    );
  });
});

// T66 — `defer` checker rules.
describe("TypeChecker: defer", () => {
  test("a module-scope defer is rejected (D2)", () => {
    expectExactError("fn g(): void {} defer g();", "defer is only allowed inside a function body");
  });

  test("a deferred call is type-checked like any other call", () => {
    expectError("fn g(a: i32): void {} fn f(): void { defer g(); }", "expects 1 arguments, got 0");
    expectError(
      "fn g(a: i32): void {} fn f(): void { defer g(1.5); }",
      "Type mismatch in argument 1",
    );
  });

  test("a deferred call to an unknown function is a normal error", () => {
    expectError("fn f(): void { defer nope(); }", "nope");
  });

  // A defer is never a terminator: the function still owes a return.
  test("a body ending in defer still requires a return", () => {
    expectError("fn g(): void {} fn f(): i32 { defer g(); }", "must return");
  });

  test("a defer inside a function reached from a global initializer is legal", () => {
    expectNoErrors(
      "fn note(): void {} fn build(): i32 { defer note(); return 7; } let table: i32 = build();",
    );
  });
});

// T66 — D1's acceptance case. The parser catches every non-call operand, so
// the message is pinned there; this asserts the text a user actually sees.
describe("TypeChecker: defer requires a call", () => {
  test("a non-call operand reports D1 verbatim", () => {
    for (const bad of ["defer x;", "defer 1 + 2;", "defer p.field;"]) {
      const parser = new Parser(`fn f(): void { let x: i32 = 1; ${bad} }`);
      parser.parse("test");
      assert(
        parser.errors.some((error) => error.message === "defer requires a function call"),
        `${bad} -> ${parser.errors.map((error) => error.message).join("; ")}`,
      );
    }
  });

  test("a deferred call is accepted", () => {
    expectNoErrors("fn g(): void {} fn f(): void { defer g(); }");
  });
});

// Review follow-ups: D3/D4 were reachable through `free` alone, so a deferred
// free and every `realloc` slipped past them.
describe("TypeChecker: D3/D4 coverage", () => {
  const SETUP = 'import malloc, free, realloc from "memory"\nstruct Cell { value: i32 }\n';

  test("a deferred free of a frame struct is rejected", () => {
    expectExactError(
      `${SETUP} fn run(): void { let c: Cell = { value = 1 }; defer free(c); }`,
      "cannot free a frame-backed value",
    );
  });

  test("a deferred free of a static binding is rejected", () => {
    expectExactError(
      `${SETUP} let shared: Cell = { value = 1 }; fn run(): void { defer free(shared); }`,
      "cannot free a static value",
    );
  });

  test("realloc of a frame struct is rejected, including under a cast", () => {
    expectExactError(
      `${SETUP} fn run(): void { let c: Cell = { value = 1 }; realloc(c, 16); }`,
      "cannot free a frame-backed value",
    );
    expectExactError(
      `${SETUP} fn run(): void { let c: Cell = { value = 1 }; let g: Cell = realloc(c, 16) as Cell; }`,
      "cannot free a frame-backed value",
    );
  });

  test("a nested allocator call is still seen", () => {
    expectExactError(
      `${SETUP} fn use(p: i32): i32 { return p; } fn run(): i32 { let c: Cell = { value = 1 }; return use(realloc(c, 8)); }`,
      "cannot free a frame-backed value",
    );
  });

  test("heap pointers remain freeable through every one of those shapes", () => {
    expectNoErrors(
      `${SETUP} fn run(): void { let c: Cell = malloc(8) as Cell; defer free(c); let g: Cell = realloc(c, 16) as Cell; }`,
    );
  });
});
