import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { typeCheck } from "../src/compiler/TypeChecker";
import type { MapleError } from "../src/compiler/errors";
import { extractModuleMeta } from "../src/compiler/emitters/module";
import { Parser } from "../src/parser/Parser";

function check(src: string): MapleError[] {
  const p = new Parser(src);
  const ast = p.parse("test");
  assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  const meta = extractModuleMeta(ast);
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
    expectError(
      "fn f(): void { for (let i: i32 = 1.5; i < 10; i = i + 1) { } }",
      "Type mismatch",
    );
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
    expectNoErrors(
      "fn add(a: i32, b: i32): i32 { return a + b; }\nfn f(): void { add(1, 2); }",
    );
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
