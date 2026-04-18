import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { extractModuleMeta } from "../src/compiler/emitters/module";
import type { MapleError } from "../src/compiler/errors";
import { typeCheck } from "../src/compiler/TypeChecker";
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

// ─── 8D: Control Flow Hardening ───────────────────────────────────────────────

describe("TypeChecker: Control Flow - Scope (Bug 5)", () => {
  test("for loop variable is not visible after the loop", () => {
    // RED: for-loop var is added to scope but never removed, so it leaks
    expectError(
      `fn f(): i32 {
        for (let i: i32 = 0; i < 5; i = i + 1) {}
        return i;
      }`,
      "i",
    );
  });

  test("for loop variable is visible inside the loop body", () => {
    // GREEN: the variable must be accessible within the loop
    expectNoErrors(`
      fn f(): void {
        for (let i: i32 = 0; i < 5; i = i + 1) {
          let x: i32 = i;
        }
      }
    `);
  });

  test("two sequential for loops with same variable name do not conflict", () => {
    // GREEN (after fix): each loop's scope is independent
    expectNoErrors(`
      fn f(): void {
        for (let i: i32 = 0; i < 3; i = i + 1) {}
        for (let i: i32 = 0; i < 5; i = i + 1) {}
      }
    `);
  });
});

describe("TypeChecker: Control Flow - Break/Continue Context (Fix 8)", () => {
  test("break outside any loop or switch is a type error", () => {
    // RED: no context validation exists yet
    expectError("fn f(): void { break; }", "break");
  });

  test("continue outside any loop is a type error", () => {
    // RED: no context validation exists yet
    expectError("fn f(): void { continue; }", "continue");
  });

  test("continue inside switch but not inside a loop is a type error", () => {
    // RED: continue should only be valid in loops, not bare switches
    expectError(
      `fn f(x: i32): void { switch (x) { case 0: { continue; } default: { break; } } }`,
      "continue",
    );
  });

  test("break inside for loop is valid", () => {
    // GREEN
    expectNoErrors("fn f(): void { for (let i: i32 = 0; i < 5; i = i + 1) { break; } }");
  });

  test("continue inside for loop is valid", () => {
    // GREEN
    expectNoErrors("fn f(): void { for (let i: i32 = 0; i < 5; i = i + 1) { continue; } }");
  });

  test("break inside while loop is valid", () => {
    // GREEN
    expectNoErrors("fn f(): void { while (1) { break; } }");
  });

  test("continue inside while loop is valid", () => {
    // GREEN
    expectNoErrors("fn f(): void { let i: i32 = 0; while (i < 5) { i = i + 1; continue; } }");
  });

  test("break inside switch is valid", () => {
    // GREEN (after fix 7 adds switch break label)
    expectNoErrors(`fn f(x: i32): void { switch (x) { case 0: { break; } default: { break; } } }`);
  });

  test("continue inside switch inside for loop is valid (targets the loop)", () => {
    // GREEN: continue in a switch that is inside a loop should be allowed
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
    // GREEN
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

// ─── 8A: Memory-Backed Local Structs — Type Checker ──────────────────────────

describe("TypeChecker: 8A Local struct member access", () => {
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
      fn origin(): P { let p: P = { x = 0, y = 0 }; return p; }
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

describe("TypeChecker: 9B multi-return and destructuring", () => {
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
    expectError("fn f(): (i32, i64) { return 1, 2; }", "Return type mismatch at position 1");
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
