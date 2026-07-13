/**
 * Integration tests: compile Maple source all the way to WAT and verify
 * structural correctness (Level 1) and, when wat2wasm is available on PATH,
 * binary validity (Level 2).
 *
 * Level 1 – pure TypeScript, no external tools needed.
 * Level 2 – shells out to `wat2wasm`. Tests are skipped if the binary is absent.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Parser } from "../src/parser/Parser";
import { compile, hasWat2Wasm, maybeTest, runExport, validateWithWat2Wasm } from "./helpers";

function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) {
    if (c === ch) n++;
  }
  return n;
}

function isBalanced(wat: string): boolean {
  return countChar(wat, "(") === countChar(wat, ")");
}

const wat2wasmAvailable = hasWat2Wasm();

describe("wat2wasm test gating", () => {
  maybeTest("runExport accepts and returns BigInt for i64 exports", () => {
    const wat = compile("export fn echo(value: i64): i64 { return value; }");
    assert.equal(runExport(wat, "echo", [123n]), 123n);
  });

  test("math tests skip when wat2wasm execution is disabled", () => {
    const result = spawnSync("npx", ["tsx", "--test", "test/math.test.ts"], {
      encoding: "utf8",
      env: {
        ...process.env,
        MAPLE_REQUIRE_WAT2WASM: undefined,
        MAPLE_SKIP_WAT2WASM: "1",
        NODE_TEST_CONTEXT: undefined,
      },
    });
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /skip/i);
  });

  test("required wat2wasm overrides disabled execution", () => {
    const result = spawnSync("npx", ["tsx", "--test", "test/math.test.ts"], {
      encoding: "utf8",
      env: {
        ...process.env,
        MAPLE_REQUIRE_WAT2WASM: "1",
        MAPLE_SKIP_WAT2WASM: "1",
        NODE_TEST_CONTEXT: undefined,
      },
    });
    assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
  });
});

// ─── Level 1: WAT structure ─────────────────────────────────────────────────

describe("Integration: WAT structure", () => {
  test("output is wrapped in a single (module ...)", () => {
    const wat = compile("fn add(a: i32, b: i32): i32 { return a + b; }");
    assert(wat.trimStart().startsWith("(module"), "WAT must start with (module");
    assert(wat.trimEnd().endsWith(")"), "WAT must end with )");
  });

  test("parentheses are balanced", () => {
    const wat = compile(`
      fn abs_diff(a: i32, b: i32): i32 {
        if (a >= b) { return a - b; }
        return b - a;
      }
    `);
    assert(
      isBalanced(wat),
      `Unbalanced parens: ${countChar(wat, "(")} open vs ${countChar(wat, ")")} close`,
    );
  });

  test("runtime memory import is always present", () => {
    const wat = compile("fn noop(): void {}");
    assert(wat.includes('(import "runtime" "memory" (memory 2))'));
  });

  test("all declared functions appear in WAT", () => {
    const wat = compile(`
      fn alpha(): i32 { return 1; }
      fn beta(): i32 { return 2; }
      fn gamma(): i32 { return alpha() + beta(); }
    `);
    assert(wat.includes("$alpha"));
    assert(wat.includes("$beta"));
    assert(wat.includes("$gamma"));
  });

  test("exported functions emit export declarations", () => {
    const wat = compile(`
      export fn add(a: i32, b: i32): i32 { return a + b; }
    `);
    assert(wat.includes('(export "add"'));
  });

  test("global variables appear in WAT", () => {
    const wat = compile(`
      let counter: i32 = 0;
      fn inc(): void { counter = counter + 1; }
    `);
    assert(wat.includes("(global $counter"));
  });

  test("multi-function program with all features has balanced WAT", () => {
    const wat = compile(`
      const MAX: i32 = 100;
      let total: i32 = 0;

      fn clamp(x: i32): i32 {
        if (x < 0) {
          return 0;
        } else if (x > MAX) {
          return MAX;
        } else {
          return x;
        }
      }

      export fn run(seed: i32): i32 {
        let i: i32 = 0;
        while (i < 10) {
          total += clamp(seed + i);
          i = i + 1;
        }
        return total;
      }
    `);
    assert(isBalanced(wat));
    assert(wat.includes("$clamp"));
    assert(wat.includes("$run"));
    assert(wat.includes("$MAX"));
    assert(wat.includes("$total"));
  });
});

describe("Integration: Operators & control flow WAT structure", () => {
  test("for loop with break and continue has balanced WAT", () => {
    const wat = compile(`
      fn sum(n: i32): i32 {
        let result: i32 = 0;
        for (let i: i32 = 0; i < n; i = i + 1) {
          if (i == 3) { continue; }
          if (i == 7) { break; }
          result += i;
        }
        return result;
      }
    `);
    assert(isBalanced(wat));
    assert(wat.includes("(loop"));
    assert(wat.includes("(block"));
  });

  test("for-loop continue branches to a $continue block so the update still runs", () => {
    const wat = compile(`
      fn sum(n: i32): i32 {
        let result: i32 = 0;
        for (let i: i32 = 0; i < n; i = i + 1) {
          if (i == 3) { continue; }
          result += i;
        }
        return result;
      }
    `);
    assert(isBalanced(wat));
    assert.match(wat, /\(block \$continue_\d+/);
    assert.match(wat, /\(br \$continue_\d+\)/);
    const err = validateWithWat2Wasm(wat);
    if (wat2wasmAvailable) {
      assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
    }
  });

  test("switch statement has balanced WAT", () => {
    const wat = compile(`
      fn classify(x: i32): i32 {
        switch (x) {
          case 0: { return 10; }
          case 1: { return 20; }
          case 2: { return 30; }
          default: { return 99; }
        }
      }
    `);
    assert(isBalanced(wat));
    assert(wat.includes("br_if"));
  });

  test("all binary operators in one function has balanced WAT", () => {
    const wat = compile(`
      fn ops(a: i32, b: i32): i32 {
        let r: i32 = (a + b) * (a - b);
        r = r / 2;
        r = r % 3;
        r = (r & b) | (r ^ b);
        r = (r << 1) >> 1;
        let cmp: i32 = (a == b) || (a != b);
        cmp = cmp && (a > b);
        cmp = cmp || (a < b);
        cmp = (a >= b) || (a <= b);
        return r + cmp;
      }
    `);
    assert(isBalanced(wat));
  });

  test("postfix and compound assignments have balanced WAT", () => {
    const wat = compile(`
      fn mutations(x: i32): i32 {
        x++;
        x--;
        x += 5;
        x -= 2;
        x *= 3;
        x /= 2;
        x %= 7;
        x &= 15;
        x |= 4;
        x ^= 1;
        x <<= 1;
        x >>= 1;
        return x;
      }
    `);
    assert(isBalanced(wat));
  });

  test("struct param and member access have balanced WAT", () => {
    const wat = compile(`
      struct Point {
        x: i32,
        y: i32,
      }

      fn manhattan(p: Point, q: Point): i32 {
        let px: i32 = p.x;
        let py: i32 = p.y;
        let qx: i32 = q.x;
        let qy: i32 = q.y;
        return (px - qx) + (py - qy);
      }
    `);
    assert(isBalanced(wat));
  });

  test("nested else-if chain has balanced WAT", () => {
    const wat = compile(`
      fn grade(score: i32): i32 {
        if (score >= 90) {
          return 5;
        } else if (score >= 75) {
          return 4;
        } else if (score >= 60) {
          return 3;
        } else {
          return 2;
        }
      }
    `);
    assert(isBalanced(wat));
    assert(wat.includes("(if"));
    assert(wat.includes("(else"));
  });
});

// ─── Level 2: wat2wasm binary validation ────────────────────────────────────

describe("Integration: wat2wasm validation", () => {
  maybeTest("simple function passes wat2wasm", () => {
    const wat = compile("fn add(a: i32, b: i32): i32 { return a + b; }");
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("for loop passes wat2wasm", () => {
    const wat = compile(`
      fn sum(n: i32): i32 {
        let total: i32 = 0;
        for (let i: i32 = 0; i < n; i = i + 1) { total += i; }
        return total;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("switch statement passes wat2wasm", () => {
    const wat = compile(`
      fn classify(x: i32): i32 {
        switch (x) {
          case 0: { return 10; }
          case 1: { return 20; }
          default: { return 99; }
        }
        return 0;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("switch default with break stays in valid label scope", () => {
    const wat = compile(`
      fn f(x: i32): void {
        switch (x) {
          case 0: { return; }
          default: { break; }
        }
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("nested f32 return if emits wat2wasm-valid output", () => {
    const wat = compile(`
      fn f(x: i32): f32 {
        if (x > 0) {
          if (x > 1) { return 1.0; } else { return 2.0; }
        } else {
          return 3.0;
        }
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("void-returning if both branches returns remains wat2wasm-valid", () => {
    const wat = compile(`
      fn f(x: i32): void {
        if (x > 0) { return; } else { return; }
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("struct param and member access passes wat2wasm", () => {
    const wat = compile(`
      struct Vec2 {
        x: i32,
        y: i32,
      }
      fn dot(v: Vec2, u: Vec2): i32 {
        let vx: i32 = v.x;
        let vy: i32 = v.y;
        let ux: i32 = u.x;
        let uy: i32 = u.y;
        return vx * ux + vy * uy;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("full-featured program passes wat2wasm", () => {
    const wat = compile(`
      const LIMIT: i32 = 100;
      let acc: i32 = 0;

      fn clamp(n: i32): i32 {
        if (n < 0) { return 0; }
        if (n > LIMIT) { return LIMIT; }
        return n;
      }

      export fn run(seed: i32): i32 {
        let i: i32 = 0;
        while (i < 5) {
          let v: i32 = clamp(seed * i);
          switch (v % 3) {
            case 0: { acc += v; }
            case 1: { acc -= 1; }
            default: { acc ^= v; }
          }
          i++;
        }
        return acc;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("void function discarding single-return call validates", () => {
    const wat = compile(`
      fn produce(): i32 { return 42; }
      export fn _start(): void {
        produce();
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  test("single-return call in statement position has trailing drop", () => {
    const wat = compile(`
      fn produce(): i32 { return 42; }
      export fn _start(): void {
        produce();
      }
    `);
    const callIdx = wat.indexOf("(call $produce");
    assert.notEqual(callIdx, -1, "expected (call $produce) in WAT");
    const after = wat.slice(callIdx);
    assert.match(
      after,
      /\(call \$produce[^\n]*\)\s*\(drop\)/,
      `expected (drop) after (call $produce): ${after}`,
    );
  });
});

// ─── Memory-Backed Local Structs — Integration ─────────────────────────

describe("Integration: local struct wat2wasm validation", () => {
  maybeTest("local struct — create, read field, return passes wat2wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 {
        let p: Point = { x = 3, y = 4 };
        return p.x + p.y;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("local struct with early return passes wat2wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn test(cond: i32): i32 {
        let p: Point = { x = 10, y = 20 };
        if (cond > 0) {
          return p.x;
        }
        return p.y;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("two local structs — read from both passes wat2wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 {
        let p: Point = { x = 1, y = 2 };
        let q: Point = { x = 3, y = 4 };
        return p.x + q.y;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("write-then-read local struct passes wat2wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 {
        let p: Point = { x = 0, y = 0 };
        p.x = 99;
        return p.x;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("loop with struct field read/write passes wat2wasm", () => {
    const wat = compile(`
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
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("method call on local struct passes wat2wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn Point.sum(self)(): i32 {
        return self.x + self.y;
      }
      fn test(): i32 {
        let p: Point = { x = 3, y = 4 };
        return p.sum();
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("method with extra arg on local struct passes wat2wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn Point.scale(self)(factor: i32): i32 {
        return (self.x + self.y) * factor;
      }
      fn test(): i32 {
        let p: Point = { x = 3, y = 4 };
        return p.scale(2);
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("f32 struct local — read f32 member passes wat2wasm", () => {
    const wat = compile(`
      struct Vec2 { x: f32, y: f32 }
      fn test(): f32 {
        let v: Vec2 = { x = 1.5, y = 2.5 };
        return v.x;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("mixed i32/f32 struct local passes wat2wasm", () => {
    const wat = compile(`
      struct Mixed { a: i32, b: f32 }
      fn test(): i32 {
        let m: Mixed = { a = 42, b = 3.14 };
        return m.a;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("void function with local struct passes wat2wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void {
        let p: Point = { x = 1, y = 2 };
        p.x = 10;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("nested function calls — both with local structs passes wat2wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn inner(): i32 {
        let q: Point = { x = 10, y = 20 };
        return q.x + q.y;
      }
      fn outer(): i32 {
        let p: Point = { x = 1, y = 2 };
        return p.x + inner();
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest(
    "P75: function without local struct calling function with local struct passes wat2wasm",
    () => {
      const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn with_struct(): i32 {
        let p: Point = { x = 5, y = 6 };
        return p.x + p.y;
      }
      fn without_struct(): i32 {
        return with_struct() + 1;
      }
    `);
      const err = validateWithWat2Wasm(wat);
      assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
    },
  );

  maybeTest("existing struct param and member access still passes wat2wasm", () => {
    const wat = compile(`
      struct Vec2 { x: i32, y: i32 }
      fn dot(v: Vec2, u: Vec2): i32 {
        let vx: i32 = v.x;
        let vy: i32 = v.y;
        let ux: i32 = u.x;
        let uy: i32 = u.y;
        return vx * ux + vy * uy;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });
});

describe("Integration: Struct literal expression values", () => {
  maybeTest("local struct with binary expression fields passes wat2wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn run(a: i32, b: i32): i32 {
        let p: Point = { x = a + b, y = a - b };
        return p.x + p.y;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("local struct with function-call field passes wat2wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn run(): i32 {
        let p: Point = { x = add(1, 2), y = 0 };
        return p.x;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("local struct with cast field passes wat2wasm", () => {
    const wat = compile(`
      struct Vec2 { x: f32, y: f32 }
      fn run(n: i32): f32 {
        let v: Vec2 = { x = n as f32, y = 0.0 };
        return v.x;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("global struct with expression field passes wat2wasm", () => {
    const wat = compile(`
      let offset: i32 = 12;
      struct Point { x: i32, y: i32 }
      let g: Point = { x = offset, y = 3 };
      export fn run(): i32 { return g.x + g.y; }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });

  maybeTest("mixed literal-only and expression global structs pass wat2wasm", () => {
    const wat = compile(`
      let offset: i32 = 7;
      struct Point { x: i32, y: i32 }
      let g1: Point = { x = 1, y = 2 };
      let g2: Point = { x = offset, y = 0 };
      export fn run(): i32 { return g1.x + g2.x; }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
  });
});

describe("Integration: Inferred function call types", () => {
  maybeTest("inferred i32 from function call compiles and passes wat2wasm", () => {
    const src = `
      fn add(a: i32, b: i32): i32 { return a + b; }
      export fn _start(): i32 {
        let x = add(1, 2);
        return x;
      }
    `;
    const wat = compile(src);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm failed: ${err}`);
  });

  maybeTest("inferred struct method call compiles and passes wat2wasm", () => {
    const src = `
      struct Pair { left: i32, right: i32, }
      fn Pair.sum(p)(): i32 { return p.left + p.right; }
      export fn _start(): i32 {
        let p: Pair = { left = 3, right = 4 };
        let s = p.sum();
        return s;
      }
    `;
    const wat = compile(src);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm failed: ${err}`);
  });

  maybeTest("inferred f32 from function call compiles and passes wat2wasm", () => {
    const src = `
      fn half(x: f32): f32 { return x; }
      export fn _start(): f32 {
        let h = half(3.14);
        return h;
      }
    `;
    const wat = compile(src);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm failed: ${err}`);
  });

  maybeTest("demo 12_math compiles and passes wat2wasm", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(dir, "../demo/12_math/main.maple"), "utf8");
    const wat = compile(src);
    assert(wat.includes('(import "math"'), "expected math imports in WAT");
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm failed: ${err}`);
  });
});

// ─── for-loop continue runs the update clause ──────────────────────────────
// Tests instantiate the compiled WASM and invoke the export, so they fail
// (rather than time out) if `continue` ever skips the for-loop's update and
// re-enters with the same loop counter.

describe("for-loop continue runs the update clause", () => {
  maybeTest("for + continue: skips body but increments", () => {
    const wat = compile(`
      export fn run(n: i32): i32 {
        let sum: i32 = 0;
        for (let i: i32 = 0; i < n; i = i + 1) {
          if (i == 3) { continue; }
          sum = sum + 1;
        }
        return sum;
      }
    `);
    assert.equal(runExport(wat, "run", [10]), 9);
    assert.equal(runExport(wat, "run", [4]), 3);
    assert.equal(runExport(wat, "run", [3]), 3);
    assert.equal(runExport(wat, "run", [0]), 0);
  });

  maybeTest("for + multiple continues in same body", () => {
    const wat = compile(`
      export fn run(n: i32): i32 {
        let sum: i32 = 0;
        for (let i: i32 = 0; i < n; i = i + 1) {
          if (i == 2) { continue; }
          if (i == 5) { continue; }
          sum = sum + i;
        }
        return sum;
      }
    `);
    // sum of 0..9 = 45, skip 2 and 5 → 38
    assert.equal(runExport(wat, "run", [10]), 38);
  });

  maybeTest("continue inside switch inside for", () => {
    const wat = compile(`
      export fn run(n: i32): i32 {
        let sum: i32 = 0;
        for (let i: i32 = 0; i < n; i = i + 1) {
          switch (i % 3) {
            case 0: { continue; }
            case 1: { sum = sum + 1; }
            default: { sum = sum + 10; }
          }
        }
        return sum;
      }
    `);
    // i=0 skip, i=1 +1, i=2 +10, i=3 skip, i=4 +1, i=5 +10
    assert.equal(runExport(wat, "run", [6]), 22);
  });

  maybeTest("continue inside nested for binds to innermost loop", () => {
    const wat = compile(`
      export fn run(): i32 {
        let total: i32 = 0;
        for (let i: i32 = 0; i < 3; i = i + 1) {
          for (let j: i32 = 0; j < 3; j = j + 1) {
            if (j == 1) { continue; }
            total = total + 1;
          }
        }
        return total;
      }
    `);
    // inner loop iterates j=0,1,2 → counts 2 per outer iter; outer = 3 → 6
    assert.equal(runExport(wat, "run"), 6);
  });

  maybeTest("continue in inner for inside outer while binds to inner for", () => {
    // Inverse nesting from the next test. Inner continue must run the inner
    // for's update, not jump back to the outer while's loop top.
    const wat = compile(`
      export fn run(): i32 {
        let outer: i32 = 0;
        let total: i32 = 0;
        while (outer < 2) {
          outer = outer + 1;
          for (let j: i32 = 0; j < 4; j = j + 1) {
            if (j == 1) { continue; }
            total = total + 1;
          }
        }
        return total;
      }
    `);
    // each outer while iter: inner for visits j=0,1,2,3; skip j==1; 3 increments
    // outer runs twice → 6
    assert.equal(runExport(wat, "run"), 6);
  });

  maybeTest("continue in nested while binds to inner while", () => {
    const wat = compile(`
      export fn run(): i32 {
        let i: i32 = 0;
        let total: i32 = 0;
        while (i < 2) {
          i = i + 1;
          let j: i32 = 0;
          while (j < 4) {
            j = j + 1;
            if (j == 2) { continue; }
            total = total + 1;
          }
        }
        return total;
      }
    `);
    // inner: j goes 1,2,3,4; skip j==2 → 3 increments per outer; outer 2 → 6
    assert.equal(runExport(wat, "run"), 6);
  });

  maybeTest("continue in inner while inside outer for runs the for update", () => {
    const wat = compile(`
      export fn run(): i32 {
        let total: i32 = 0;
        for (let i: i32 = 0; i < 4; i = i + 1) {
          let j: i32 = 0;
          while (j < 3) {
            j = j + 1;
            if (j == 2) { continue; }
            total = total + 1;
          }
        }
        return total;
      }
    `);
    // each outer iter: while increments j to 1,2,3; +1 at j=1 and j=3 → 2; outer 4 → 8
    assert.equal(runExport(wat, "run"), 8);
  });

  maybeTest("break and continue coexist in same for", () => {
    const wat = compile(`
      export fn run(n: i32): i32 {
        let sum: i32 = 0;
        for (let i: i32 = 0; i < n; i = i + 1) {
          if (i == 4) { break; }
          if (i == 2) { continue; }
          sum = sum + 1;
        }
        return sum;
      }
    `);
    // i=0 +1, i=1 +1, i=2 skip, i=3 +1, i=4 break → 3
    assert.equal(runExport(wat, "run", [10]), 3);
  });

  maybeTest("continue in while re-checks condition", () => {
    const wat = compile(`
      export fn run(): i32 {
        let i: i32 = 0;
        let sum: i32 = 0;
        while (i < 10) {
          i = i + 1;
          if (i == 5) { continue; }
          sum = sum + i;
        }
        return sum;
      }
    `);
    // sum of 1..10 = 55, minus 5 → 50
    assert.equal(runExport(wat, "run"), 50);
  });

  maybeTest("for without continue still works", () => {
    const wat = compile(`
      export fn run(n: i32): i32 {
        let sum: i32 = 0;
        for (let i: i32 = 0; i < n; i = i + 1) {
          sum = sum + i;
        }
        return sum;
      }
    `);
    assert.equal(runExport(wat, "run", [5]), 10); // 0+1+2+3+4
  });

  maybeTest("for with continue triggered every iteration terminates", () => {
    // If continue ever skips the for-update, this hangs instead of returning 0.
    const wat = compile(`
      export fn run(n: i32): i32 {
        let touched: i32 = 0;
        for (let i: i32 = 0; i < n; i = i + 1) {
          continue;
          touched = touched + 1;
        }
        return touched;
      }
    `);
    assert.equal(runExport(wat, "run", [100]), 0);
  });

  // Structural assertion: every for-loop in the codegen wraps its body in a
  // continue-block. Pins the implementation choice.
  test("emitted for-loop wraps body in a $continue block", () => {
    const wat = compile(`
      fn f(): i32 {
        let s: i32 = 0;
        for (let i: i32 = 0; i < 3; i = i + 1) {
          s = s + 1;
        }
        return s;
      }
    `);
    assert.match(wat, /\(loop \$loop_\d+/);
    assert.match(wat, /\(block \$continue_\d+/);
  });
});

// ─── && and || short-circuit ───────────────────────────────────────────────
// Side-effect probes: each subject calls a helper that mutates a global
// counter, then returns. If the operator evaluates the right-hand side when
// it shouldn't, the counter will be too high. The runtime invocations are
// the source of truth — pure WAT structure tests can't distinguish "emitted
// the right opcode" from "actually short-circuits."

describe("&& and || short-circuit", () => {
  maybeTest("&& with false LHS does not evaluate RHS", () => {
    const wat = compile(`
      let count: i32 = 0;
      fn tick(): i32 { count = count + 1; return 1; }
      export fn run(): i32 {
        let r: i32 = 0 && tick();
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 0);
  });

  maybeTest("&& with true LHS does evaluate RHS", () => {
    const wat = compile(`
      let count: i32 = 0;
      fn tick(): i32 { count = count + 1; return 1; }
      export fn run(): i32 {
        let r: i32 = 1 && tick();
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("|| with true LHS does not evaluate RHS", () => {
    const wat = compile(`
      let count: i32 = 0;
      fn tick(): i32 { count = count + 1; return 1; }
      export fn run(): i32 {
        let r: i32 = 1 || tick();
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 0);
  });

  maybeTest("|| with false LHS does evaluate RHS", () => {
    const wat = compile(`
      let count: i32 = 0;
      fn tick(): i32 { count = count + 1; return 1; }
      export fn run(): i32 {
        let r: i32 = 0 || tick();
        return count;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("&& and || still produce correct boolean results", () => {
    const wat = compile(`
      export fn and_ff(): i32 { let r: i32 = 0 && 0; return r; }
      export fn and_ft(): i32 { let r: i32 = 0 && 1; return r; }
      export fn and_tf(): i32 { let r: i32 = 1 && 0; return r; }
      export fn and_tt(): i32 { let r: i32 = 1 && 1; return r; }
      export fn or_ff(): i32  { let r: i32 = 0 || 0; return r; }
      export fn or_ft(): i32  { let r: i32 = 0 || 1; return r; }
      export fn or_tf(): i32  { let r: i32 = 1 || 0; return r; }
      export fn or_tt(): i32  { let r: i32 = 1 || 1; return r; }
    `);
    assert.equal(runExport(wat, "and_ff"), 0);
    assert.equal(runExport(wat, "and_ft"), 0);
    assert.equal(runExport(wat, "and_tf"), 0);
    assert.equal(runExport(wat, "and_tt"), 1);
    assert.equal(runExport(wat, "or_ff"), 0);
    assert.equal(runExport(wat, "or_ft"), 1);
    assert.equal(runExport(wat, "or_tf"), 1);
    assert.equal(runExport(wat, "or_tt"), 1);
  });

  maybeTest("chained && short-circuits at first false", () => {
    const wat = compile(`
      let count: i32 = 0;
      fn tick(): i32 { count = count + 1; return 1; }
      export fn run(): i32 {
        let r: i32 = tick() && 0 && tick();
        return count;
      }
    `);
    // first tick (1) → 0 → short-circuit. RHS tick must not run.
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("chained || short-circuits at first true", () => {
    const wat = compile(`
      let count: i32 = 0;
      fn tick(): i32 { count = count + 1; return 1; }
      export fn run(): i32 {
        let r: i32 = tick() || tick() || tick();
        return count;
      }
    `);
    // first tick returns 1 → short-circuit; only one tick.
    assert.equal(runExport(wat, "run"), 1);
  });
});

// ─── unsigned float casts use _u opcodes ───────────────────────────────────
// For values ≥ 2^31, signed convert/trunc opcodes give the wrong answer. The
// runtime tests use round-trips and bit-level comparisons because wasmtime
// displays u32 as signed, which can mask the bug at the CLI but not at the
// language level.

describe("unsigned int <-> float casts", () => {
  maybeTest("u32 → f32 → u32 round-trips for values above 2^31", () => {
    const wat = compile(`
      export fn run(): i32 {
        let x: u32 = 3000000000;
        let f: f32 = x as f32;
        let back: u32 = f as u32;
        if (back == x) { return 1; }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("u32 → f64 → u32 round-trips for values above 2^31", () => {
    const wat = compile(`
      export fn run(): i32 {
        let x: u32 = 3500000000;
        let f: f64 = x as f64;
        let back: u32 = f as u32;
        if (back == x) { return 1; }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("u32 → f32 emits convert_i32_u in WAT", () => {
    const wat = compile(`
      export fn run(): f32 {
        let x: u32 = 1;
        return x as f32;
      }
    `);
    assert.match(wat, /f32\.convert_i32_u/);
    assert(!wat.includes("f32.convert_i32_s"));
  });

  maybeTest("f32 → u32 emits trunc_f32_u in WAT", () => {
    const wat = compile(`
      export fn run(): u32 {
        let f: f32 = 100.0;
        return f as u32;
      }
    `);
    assert.match(wat, /i32\.trunc_f32_u/);
    assert(!wat.includes("i32.trunc_f32_s"));
  });

  maybeTest("signed i32 → f32 still uses convert_i32_s", () => {
    const wat = compile(`
      export fn run(): f32 {
        let x: i32 = 0 - 5;
        return x as f32;
      }
    `);
    assert.match(wat, /f32\.convert_i32_s/);
    assert(!wat.includes("f32.convert_i32_u"));
  });

  maybeTest("signed i32 → f32 → i32 preserves negative values", () => {
    const wat = compile(`
      export fn run(): i32 {
        let x: i32 = 0 - 42;
        let f: f32 = x as f32;
        return f as i32;
      }
    `);
    assert.equal(runExport(wat, "run"), -42);
  });

  maybeTest("u8 → f32 emits unsigned convert", () => {
    const wat = compile(`
      export fn run(): f32 {
        let x: u8 = 200;
        return x as f32;
      }
    `);
    assert.match(wat, /f32\.convert_i32_u/);
  });
});

// ─── unused call results are dropped at statement position ─────────────────
// Pins both (a) the WAT contains the right number of (drop)s and (b) the
// resulting module instantiates and runs without trapping. A leftover stack
// value here causes wat2wasm to reject the module in void context.

describe("unused call results are dropped at statement position", () => {
  maybeTest("void function discarding i32-returning call instantiates", () => {
    const wat = compile(`
      fn produce(): i32 { return 42; }
      export fn _start(): void {
        produce();
      }
    `);
    runExport(wat, "_start");
  });

  maybeTest("void function discarding i64-returning call instantiates", () => {
    const wat = compile(`
      fn produce(): i64 { return 42 as i64; }
      export fn _start(): void {
        produce();
      }
    `);
    runExport(wat, "_start");
  });

  maybeTest("void function discarding f32-returning call instantiates", () => {
    const wat = compile(`
      fn produce(): f32 { return 1.5; }
      export fn _start(): void {
        produce();
      }
    `);
    runExport(wat, "_start");
  });

  maybeTest("void function discarding f64-returning call instantiates", () => {
    const wat = compile(`
      fn produce(): f64 { return 1.5 as f64; }
      export fn _start(): void {
        produce();
      }
    `);
    runExport(wat, "_start");
  });

  maybeTest("multiple discarded calls in sequence don't leak stack", () => {
    const wat = compile(`
      fn produce(): i32 { return 42; }
      export fn _start(): void {
        produce();
        produce();
        produce();
      }
    `);
    runExport(wat, "_start");
  });

  maybeTest("discarded call in value-returning fn doesn't corrupt result", () => {
    const wat = compile(`
      fn produce(): i32 { return 999; }
      export fn run(): i32 {
        produce();
        produce();
        return 7;
      }
    `);
    assert.equal(runExport(wat, "run"), 7);
  });

  maybeTest("discarded multi-return call instantiates and runs", () => {
    const wat = compile(`
      fn pair(): (i32, i32) { return 1, 2; }
      export fn _start(): void {
        pair();
      }
    `);
    runExport(wat, "_start");
  });

  maybeTest("call result that is assigned does NOT get extra drop", () => {
    const wat = compile(`
      fn produce(): i32 { return 42; }
      export fn run(): i32 {
        let x: i32 = produce();
        return x;
      }
    `);
    // Result must be 42 — if an extra drop sneaks in it'd corrupt the assignment.
    assert.equal(runExport(wat, "run"), 42);
  });

  test("WAT: single-return discard → exactly one (drop)", () => {
    const wat = compile(`
      fn produce(): i32 { return 42; }
      export fn _start(): void {
        produce();
      }
    `);
    // Strip whitespace and look at sequence after each call site.
    const calls = wat.match(/\(call \$produce[^)]*\)\s*\(drop\)/g) ?? [];
    assert.equal(calls.length, 1, `expected 1 call+drop, got WAT:\n${wat}`);
  });

  test("WAT: multi-return discard → N (drop)s", () => {
    const wat = compile(`
      fn pair(): (i32, i32) { return 1, 2; }
      export fn _start(): void {
        pair();
      }
    `);
    const idx = wat.indexOf("(call $pair");
    assert.notEqual(idx, -1);
    const after = wat.slice(idx);
    const drops = after.match(/\(drop\)/g) ?? [];
    assert(drops.length >= 2, `expected ≥2 drops after multi-return call, got:\n${after}`);
  });

  test("WAT: void-returning call → NO (drop)", () => {
    // Use an imported void fn so we don't need to declare a value-returning helper.
    const wat = compile(`
      import malloc, free from "memory"
      export fn _start(): void {
        let p: i32 = malloc(8);
        free(p);
      }
    `);
    const idx = wat.indexOf("(call $free");
    assert.notEqual(idx, -1);
    // Bound the search to the current function body so a drop in some later
    // function doesn't falsely match.
    const after = wat.slice(idx);
    const stopAt = after.indexOf("$_start");
    const window = stopAt === -1 ? after.slice(0, 200) : after.slice(0, stopAt);
    assert(!window.includes("(drop)"), `unexpected drop after void call: ${window}`);
  });

  test("WAT: assigned call result → NO trailing drop on call", () => {
    const wat = compile(`
      fn produce(): i32 { return 42; }
      export fn run(): i32 {
        let x: i32 = produce();
        return x;
      }
    `);
    assert(
      !/\(call \$produce[^\n]*\)\s*\(drop\)/.test(wat),
      `unexpected drop in assignment: ${wat}`,
    );
  });

  // Indirect call through fn-ref needs the "memory" stdlib at instantiate
  // time (for __make_fnref allocation), which the minimal harness above does
  // not provide. Assert via WAT structure + wat2wasm validation instead.
  maybeTest("indirect call via fn-typed variable: WAT has drop after call_indirect", () => {
    const wat = compile(`
      fn add(a: i32, b: i32): i32 { return a + b; }
      export fn _start(): void {
        let f: fn(i32,i32):i32 = add;
        f(1, 2);
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected WAT: ${err}`);
    const idx = wat.indexOf("(call_indirect");
    assert.notEqual(idx, -1, "expected call_indirect in WAT");
    const after = wat.slice(idx);
    // Find the matching close-paren for the call_indirect, then look for (drop) right after.
    let depth = 0;
    let endIdx = -1;
    for (let i = 0; i < after.length; i++) {
      if (after[i] === "(") depth++;
      else if (after[i] === ")") {
        depth--;
        if (depth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    assert(endIdx > 0, "could not find end of call_indirect");
    const tail = after.slice(endIdx, endIdx + 40);
    assert.match(tail, /\s*\(drop\)/, `expected (drop) after call_indirect: ${tail}`);
  });
});

// ─── for-loop semantics with non-zero starts and varied steps ──────────────
// The demos only use `for (let i = 0; i < n; i = i + 1)`. These exercise
// non-zero starts, decrementing counters, expression bounds, and varied
// step sizes.

describe("for-loop non-trivial bounds", () => {
  maybeTest("counts up from 5", () => {
    const wat = compile(`
      export fn run(): i32 {
        let total: i32 = 0;
        for (let i: i32 = 5; i < 10; i = i + 1) {
          total = total + i;
        }
        return total;
      }
    `);
    assert.equal(runExport(wat, "run"), 5 + 6 + 7 + 8 + 9);
  });

  maybeTest("counts down from 10 to 0 exclusive", () => {
    const wat = compile(`
      export fn run(): i32 {
        let total: i32 = 0;
        for (let i: i32 = 10; i > 0; i = i - 1) {
          total = total + i;
        }
        return total;
      }
    `);
    assert.equal(runExport(wat, "run"), 55);
  });

  maybeTest("counts down inclusive to zero", () => {
    const wat = compile(`
      export fn run(): i32 {
        let total: i32 = 0;
        for (let i: i32 = 5; i >= 0; i = i - 1) {
          total = total + i;
        }
        return total;
      }
    `);
    assert.equal(runExport(wat, "run"), 15);
  });

  maybeTest("steps by 2", () => {
    const wat = compile(`
      export fn run(): i32 {
        let total: i32 = 0;
        for (let i: i32 = 0; i < 10; i = i + 2) {
          total = total + 1;
        }
        return total;
      }
    `);
    assert.equal(runExport(wat, "run"), 5);
  });

  maybeTest("init from parameter expression", () => {
    const wat = compile(`
      export fn run(start: i32, count: i32): i32 {
        let total: i32 = 0;
        for (let i: i32 = start; i < start + count; i = i + 1) {
          total = total + i;
        }
        return total;
      }
    `);
    assert.equal(runExport(wat, "run", [3, 4]), 3 + 4 + 5 + 6);
    assert.equal(runExport(wat, "run", [-2, 5]), -2 + -1 + 0 + 1 + 2);
    assert.equal(runExport(wat, "run", [100, 0]), 0);
  });

  maybeTest("update is an expression call to itself", () => {
    const wat = compile(`
      export fn run(): i32 {
        let total: i32 = 0;
        for (let i: i32 = 1; i < 100; i = i * 2) {
          total = total + 1;
        }
        return total;
      }
    `);
    // 1, 2, 4, 8, 16, 32, 64 → 7
    assert.equal(runExport(wat, "run"), 7);
  });

  maybeTest("zero iterations when init violates condition", () => {
    const wat = compile(`
      export fn run(): i32 {
        let touched: i32 = 0;
        for (let i: i32 = 100; i < 50; i = i + 1) {
          touched = 999;
        }
        return touched;
      }
    `);
    assert.equal(runExport(wat, "run"), 0);
  });

  maybeTest("break exits at exact iteration", () => {
    const wat = compile(`
      export fn run(): i32 {
        let last: i32 = -1;
        for (let i: i32 = 10; i < 100; i = i + 1) {
          if (i == 15) { break; }
          last = i;
        }
        return last;
      }
    `);
    assert.equal(runExport(wat, "run"), 14);
  });

  maybeTest("nested for with distinct bounds runs full cartesian", () => {
    const wat = compile(`
      export fn run(): i32 {
        let pairs: i32 = 0;
        for (let i: i32 = 1; i < 4; i = i + 1) {
          for (let j: i32 = 10; j < 13; j = j + 1) {
            pairs = pairs + 1;
          }
        }
        return pairs;
      }
    `);
    assert.equal(runExport(wat, "run"), 9);
  });

  maybeTest("i64 counter from non-zero start", () => {
    const wat = compile(`
      export fn run(): i32 {
        let total: i64 = 0 as i64;
        for (let i: i64 = 100 as i64; i < 105 as i64; i = i + 1 as i64) {
          total = total + i;
        }
        return total as i32;
      }
    `);
    assert.equal(runExport(wat, "run"), 100 + 101 + 102 + 103 + 104);
  });
});

// ─── while-loop conditions and break placement ─────────────────────────────

describe("while-loop variations", () => {
  maybeTest("condition involving function call re-evaluated each iteration", () => {
    const wat = compile(`
      fn under(n: i32, limit: i32): i32 {
        if (n < limit) { return 1; }
        return 0;
      }
      export fn run(limit: i32): i32 {
        let i: i32 = 0;
        while (under(i, limit)) {
          i = i + 1;
        }
        return i;
      }
    `);
    assert.equal(runExport(wat, "run", [7]), 7);
    assert.equal(runExport(wat, "run", [0]), 0);
  });

  maybeTest("break mid-loop returns the partial count", () => {
    const wat = compile(`
      export fn run(): i32 {
        let i: i32 = 0;
        while (i < 100) {
          if (i == 13) { break; }
          i = i + 1;
        }
        return i;
      }
    `);
    assert.equal(runExport(wat, "run"), 13);
  });

  maybeTest("condition uses && — both subconditions checked", () => {
    const wat = compile(`
      export fn run(a: i32, b: i32): i32 {
        let n: i32 = 0;
        while (n < a && n < b) {
          n = n + 1;
        }
        return n;
      }
    `);
    assert.equal(runExport(wat, "run", [5, 10]), 5);
    assert.equal(runExport(wat, "run", [10, 5]), 5);
    assert.equal(runExport(wat, "run", [0, 100]), 0);
  });
});

// ─── recursion ─────────────────────────────────────────────────────────────

describe("recursion", () => {
  maybeTest("factorial via recursion", () => {
    const wat = compile(`
      fn fact(n: i32): i32 {
        if (n <= 1) { return 1; }
        return n * fact(n - 1);
      }
      export fn run(n: i32): i32 { return fact(n); }
    `);
    assert.equal(runExport(wat, "run", [0]), 1);
    assert.equal(runExport(wat, "run", [1]), 1);
    assert.equal(runExport(wat, "run", [5]), 120);
    assert.equal(runExport(wat, "run", [10]), 3628800);
  });

  maybeTest("fibonacci via recursion", () => {
    const wat = compile(`
      fn fib(n: i32): i32 {
        if (n < 2) { return n; }
        return fib(n - 1) + fib(n - 2);
      }
      export fn run(n: i32): i32 { return fib(n); }
    `);
    assert.equal(runExport(wat, "run", [0]), 0);
    assert.equal(runExport(wat, "run", [1]), 1);
    assert.equal(runExport(wat, "run", [10]), 55);
  });

  maybeTest("mutual recursion: even/odd", () => {
    const wat = compile(`
      fn is_even(n: i32): i32 {
        if (n == 0) { return 1; }
        return is_odd(n - 1);
      }
      fn is_odd(n: i32): i32 {
        if (n == 0) { return 0; }
        return is_even(n - 1);
      }
      export fn run(n: i32): i32 { return is_even(n); }
    `);
    assert.equal(runExport(wat, "run", [0]), 1);
    assert.equal(runExport(wat, "run", [1]), 0);
    assert.equal(runExport(wat, "run", [10]), 1);
    assert.equal(runExport(wat, "run", [11]), 0);
  });

  maybeTest("accumulator-passing recursion (tail style)", () => {
    const wat = compile(`
      fn sum_acc(n: i32, acc: i32): i32 {
        if (n == 0) { return acc; }
        return sum_acc(n - 1, acc + n);
      }
      export fn run(n: i32): i32 { return sum_acc(n, 0); }
    `);
    assert.equal(runExport(wat, "run", [5]), 15);
    assert.equal(runExport(wat, "run", [10]), 55);
  });
});

// ─── arithmetic edge cases ─────────────────────────────────────────────────

describe("arithmetic edge cases", () => {
  maybeTest("signed integer division with negative dividend", () => {
    const wat = compile(`
      export fn run(a: i32, b: i32): i32 { return a / b; }
    `);
    assert.equal(runExport(wat, "run", [-10, 3]), -3);
    assert.equal(runExport(wat, "run", [10, -3]), -3);
    assert.equal(runExport(wat, "run", [-10, -3]), 3);
  });

  maybeTest("signed modulo preserves sign of dividend", () => {
    const wat = compile(`
      export fn run(a: i32, b: i32): i32 { return a % b; }
    `);
    assert.equal(runExport(wat, "run", [-10, 3]), -1);
    assert.equal(runExport(wat, "run", [10, -3]), 1);
  });

  maybeTest("i32 wraps on overflow", () => {
    const wat = compile(`
      export fn run(): i32 { return 2147483647 + 1; }
    `);
    assert.equal(runExport(wat, "run"), -2147483648);
  });

  maybeTest("i64 arithmetic above i32 range", () => {
    const wat = compile(`
      export fn run(a: i32, b: i32): i32 {
        let x: i64 = a as i64;
        let y: i64 = b as i64;
        let prod: i64 = x * y;
        return prod as i32;
      }
    `);
    // 100000 * 100000 = 10_000_000_000 which is > i32 range,
    // truncated as i32 → 1410065408
    assert.equal(runExport(wat, "run", [100000, 100000]), 1410065408);
  });

  maybeTest("float division and float mod (custom lowering)", () => {
    const wat = compile(`
      export fn divf(a: f32, b: f32): f32 { return a / b; }
      export fn modf(a: f32, b: f32): f32 { return a % b; }
    `);
    const divResult = runExport(wat, "divf", [9, 4]) as number;
    assert(Math.abs(divResult - 2.25) < 1e-6);
    const modResult = runExport(wat, "modf", [9, 4]) as number;
    assert(Math.abs(modResult - 1.0) < 1e-6);
  });

  maybeTest("comparison ops produce 0/1 i32", () => {
    const wat = compile(`
      export fn lt(a: i32, b: i32): i32 {
        if (a < b) { return 1; }
        return 0;
      }
      export fn ge(a: i32, b: i32): i32 {
        if (a >= b) { return 1; }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "lt", [1, 2]), 1);
    assert.equal(runExport(wat, "lt", [2, 1]), 0);
    assert.equal(runExport(wat, "lt", [1, 1]), 0);
    assert.equal(runExport(wat, "ge", [1, 1]), 1);
    assert.equal(runExport(wat, "ge", [0, 1]), 0);
  });

  // Compound op on a wider type with a narrower literal. The literal `5` is
  // i32 by default; the emitter currently throws "incompatible binary operand
  // lanes i64 vs i32".
  maybeTest("i64 += integer literal compiles", () => {
    const wat = compile(`
      export fn run(): i32 {
        let x: i64 = 1 as i64;
        x += 5;
        return x as i32;
      }
    `);
    assert.equal(runExport(wat, "run"), 6);
  });
});

// ─── bitwise and shift ops ─────────────────────────────────────────────────

describe("bitwise and shift", () => {
  maybeTest("AND/OR/XOR with concrete bit patterns", () => {
    const wat = compile(`
      export fn band(a: i32, b: i32): i32 { return a & b; }
      export fn bor(a: i32, b: i32): i32 { return a | b; }
      export fn bxor(a: i32, b: i32): i32 { return a ^ b; }
    `);
    assert.equal(runExport(wat, "band", [0b1100, 0b1010]), 0b1000);
    assert.equal(runExport(wat, "bor", [0b1100, 0b1010]), 0b1110);
    assert.equal(runExport(wat, "bxor", [0b1100, 0b1010]), 0b0110);
  });

  maybeTest("left shift", () => {
    const wat = compile(`
      export fn shl(a: i32, b: i32): i32 { return a << b; }
    `);
    assert.equal(runExport(wat, "shl", [1, 0]), 1);
    assert.equal(runExport(wat, "shl", [1, 5]), 32);
    assert.equal(runExport(wat, "shl", [3, 4]), 48);
  });

  maybeTest("signed right shift preserves sign", () => {
    const wat = compile(`
      export fn shr(a: i32, b: i32): i32 { return a >> b; }
    `);
    assert.equal(runExport(wat, "shr", [-16, 2]), -4);
    assert.equal(runExport(wat, "shr", [16, 2]), 4);
  });

  maybeTest("XOR with -1 flips all bits", () => {
    const wat = compile(`
      export fn run(a: i32): i32 { return a ^ (0 - 1); }
    `);
    assert.equal(runExport(wat, "run", [0]), -1);
    assert.equal(runExport(wat, "run", [-1]), 0);
    assert.equal(runExport(wat, "run", [5]), -6);
  });
});

// ─── compound assignment operators ─────────────────────────────────────────

describe("compound assignments", () => {
  maybeTest("+= -= *= /= %= on local", () => {
    const wat = compile(`
      export fn run(): i32 {
        let x: i32 = 100;
        x += 5;     // 105
        x -= 10;    // 95
        x *= 2;     // 190
        x /= 4;     // 47
        x %= 10;    // 7
        return x;
      }
    `);
    assert.equal(runExport(wat, "run"), 7);
  });

  maybeTest("+= with expression rhs", () => {
    const wat = compile(`
      export fn run(n: i32): i32 {
        let total: i32 = 0;
        for (let i: i32 = 1; i <= n; i = i + 1) {
          total += i * 2;
        }
        return total;
      }
    `);
    // sum(2,4,6,8,10) = 30 for n=5
    assert.equal(runExport(wat, "run", [5]), 30);
  });

  maybeTest("postfix ++ and -- as statement", () => {
    const wat = compile(`
      export fn run(): i32 {
        let x: i32 = 10;
        x++;
        x++;
        x--;
        return x;
      }
    `);
    assert.equal(runExport(wat, "run"), 11);
  });

  // Compound assignment on a struct field — currently emit throws
  // "compound assignment for members not implemented".
  test("compound assignment on a struct field is supported", () => {
    let threw = false;
    try {
      compile(`
        struct P { x: i32 }
        export fn run(): i32 {
          let p: P = { x = 10 };
          p.x += 5;
          return p.x;
        }
      `);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "compile should not throw on `p.x += 5`");
  });

  // Postfix on a struct field — currently reports "Undefined identifier 'x'"
  // because the postfix path goes through the identifier resolver.
  test("postfix on a struct field is supported", () => {
    let threw = false;
    try {
      compile(`
        struct P { x: i32 }
        export fn run(): i32 {
          let p: P = { x = 10 };
          p.x++;
          return p.x;
        }
      `);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "compile should not throw on `p.x++`");
  });

  // Postfix on an array element — currently "postfix statement only supports
  // identifiers".
  test("postfix on an array element is supported", () => {
    let threw = false;
    try {
      compile(`
        export fn run(): i32 {
          let arr: i32[] = [1, 2, 3];
          arr[1]++;
          return arr[1];
        }
      `);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "compile should not throw on `arr[1]++`");
  });
});

// ─── struct field access on offsets > 0 ────────────────────────────────────

describe("structs", () => {
  maybeTest("read fields at every offset", () => {
    const wat = compile(`
      struct Quad { a: i32, b: i32, c: i32, d: i32 }
      export fn run(): i32 {
        let q: Quad = { a = 10, b = 20, c = 30, d = 40 };
        return q.d - q.c + q.b - q.a;
      }
    `);
    // 40 - 30 + 20 - 10 = 20
    assert.equal(runExport(wat, "run"), 20);
  });

  maybeTest("write field at non-first offset preserves others", () => {
    const wat = compile(`
      struct Triple { x: i32, y: i32, z: i32 }
      export fn run(): i32 {
        let t: Triple = { x = 1, y = 2, z = 3 };
        t.y = 99;
        return t.x * 1000 + t.y * 100 + t.z;
      }
    `);
    // x=1 unchanged, y=99 written, z=3 unchanged → 1 * 1000 + 99 * 100 + 3
    assert.equal(runExport(wat, "run"), 1000 + 9900 + 3);
  });

  maybeTest("struct with i64 field reads back correctly", () => {
    const wat = compile(`
      struct Big { tag: i32, big: i64 }
      export fn run(): i32 {
        let b: Big = { tag = 7, big = 1000000 as i64 };
        return b.tag + (b.big as i32);
      }
    `);
    assert.equal(runExport(wat, "run"), 1000007);
  });

  maybeTest("struct with f32 fields", () => {
    const wat = compile(`
      struct V { x: f32, y: f32 }
      export fn run(): i32 {
        let v: V = { x = 3.0, y = 4.0 };
        let m: f32 = v.x * v.x + v.y * v.y;
        return m as i32;
      }
    `);
    assert.equal(runExport(wat, "run"), 25);
  });

  // Field offsets should align each field to its natural boundary, and the
  // struct's size should pad to a multiple of the largest field's alignment.
  // `struct M { a: u8, b: i32 }` currently packs b at offset 1, size 5.
  maybeTest("struct {u8, i32} aligns b to offset 4 and has size 8", () => {
    const wat = compile(`
      struct M { a: u8, b: i32 }
      export fn run(): i32 {
        let m: M = { a = 7, b = 100 };
        return (m.a as i32) + m.b;
      }
    `);
    const frame = wat.match(/i32\.sub \(global\.get \$__sp\) \(i32\.const (\d+)\)/);
    assert(frame, "could not find shadow-stack frame allocation");
    const structSize = Number.parseInt(frame[1]!, 10);
    assert.equal(structSize, 8, `struct M sized ${structSize} bytes (expected 8 with alignment)`);
    const storeB = wat.match(
      /\(i32\.store \(i32\.add \(local\.get \$m\) \(i32\.const (\d+)\)\) \(i32\.const 100\)\)/,
    );
    assert(storeB, "could not find i32.store of value 100 to field b");
    assert.equal(storeB[1], "4", `field b stored at offset ${storeB[1]} (expected 4)`);
  });

  // Struct equality silently does pointer comparison instead of field-wise
  // compare. Either the typechecker should reject it, or it should do the
  // expected structural comparison.
  maybeTest("struct == struct compares fields (or is rejected)", () => {
    const wat = compile(`
      struct P { x: i32, y: i32 }
      export fn run(): i32 {
        let a: P = { x = 5, y = 7 };
        let b: P = { x = 5, y = 7 };
        if (a == b) { return 1; }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  test("an empty struct parses", () => {
    const p = new Parser(`
      struct Unit {}
      fn f(): Unit { let u: Unit = {}; return u; }
    `);
    p.parse("test");
    assert.equal(p.errors.length, 0, `parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  });

  // An empty (marker) struct can be declared, instantiated, and passed back.
  maybeTest("empty struct can be instantiated and used as a marker type", () => {
    const wat = compile(`
      struct Marker {}
      fn make(): Marker { let m: Marker = {}; return m; }
      export fn run(): i32 {
        let m: Marker = make();
        return 7;
      }
    `);
    assert.equal(runExport(wat, "run"), 7);
  });

  // Struct literal containing another struct literal as a field value.
  test("nested struct literal as a field value parses", () => {
    const p = new Parser(`
      struct A { v: i32 }
      struct B { a: A }
      fn f(): i32 {
        let b: B = { a = { v = 42 } };
        return b.a.v;
      }
    `);
    p.parse("test");
    assert.equal(p.errors.length, 0, `parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  });

  // Struct literal as an argument avoids an intermediate let.
  test("struct literal as a function argument parses", () => {
    const p = new Parser(`
      struct P { x: i32 }
      fn take(p: P): i32 { return p.x; }
      fn run(): i32 { return take({ x = 42 }); }
    `);
    p.parse("test");
    assert.equal(p.errors.length, 0, `parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  });

  // Returning a struct literal directly without a let-binding.
  test("returning a struct literal directly parses", () => {
    const p = new Parser(`
      struct P { x: i32, y: i32 }
      fn make(): P { return { x = 1, y = 2 }; }
    `);
    p.parse("test");
    assert.equal(p.errors.length, 0, `parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  });

  // A struct field of fn-type should work — same as a let binding of fn-type
  // does today.
  maybeTest("struct field of fn-type can be called via .field()", () => {
    const wat = compile(`
      struct Handler { cb: fn(i32):i32 }
      fn dbl(x: i32): i32 { return x * 2; }
      export fn run(): i32 {
        let h: Handler = { cb = dbl };
        return h.cb(5);
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected: ${err}`);
  });

  // A global struct literal containing a string field fails with
  // "unsupported type: string" during emit.
  maybeTest("global struct with a string field compiles", () => {
    const wat = compile(`
      struct M { tag: i32, msg: string }
      let g: M = { tag = 1, msg = "hello" };
      export fn run(): i32 { return g.msg.len; }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected: ${err}`);
  });

  // Member access on a function call (`make().x`) avoids a throwaway let.
  maybeTest("member access chained after a function call works", () => {
    const wat = compile(`
      struct P { x: i32 }
      fn make(): P { let p: P = { x = 42 }; return p; }
      export fn run(): i32 { return make().x; }
    `);
    assert.equal(runExport(wat, "run"), 42);
  });
});

// ─── array operations driven by loops ──────────────────────────────────────

describe("array operations", () => {
  maybeTest("write all elements via loop, read back via loop", () => {
    const wat = compile(`
      export fn run(): i32 {
        let arr: i32[] = [0, 0, 0, 0, 0];
        for (let i: i32 = 0; i < 5; i = i + 1) {
          arr[i] = i * i;
        }
        let total: i32 = 0;
        for (let i: i32 = 0; i < 5; i = i + 1) {
          total = total + arr[i];
        }
        return total;
      }
    `);
    // 0 + 1 + 4 + 9 + 16 = 30
    assert.equal(runExport(wat, "run"), 30);
  });

  maybeTest("find max of array", () => {
    const wat = compile(`
      export fn run(): i32 {
        let arr: i32[] = [3, 7, 1, 9, 4, 6];
        let max: i32 = arr[0];
        for (let i: i32 = 1; i < 6; i = i + 1) {
          if (arr[i] > max) { max = arr[i]; }
        }
        return max;
      }
    `);
    assert.equal(runExport(wat, "run"), 9);
  });

  maybeTest("swap two elements via temp", () => {
    const wat = compile(`
      export fn run(): i32 {
        let arr: i32[] = [10, 20, 30];
        let t: i32 = arr[0];
        arr[0] = arr[2];
        arr[2] = t;
        return arr[0] * 100 + arr[1] * 10 + arr[2];
      }
    `);
    // [30, 20, 10] → 3020 + 200 + 10? 30*100=3000 + 20*10=200 + 10=3210
    assert.equal(runExport(wat, "run"), 3210);
  });

  maybeTest("array index from function parameter", () => {
    const wat = compile(`
      export fn run(i: i32): i32 {
        let arr: i32[] = [11, 22, 33, 44, 55];
        return arr[i];
      }
    `);
    assert.equal(runExport(wat, "run", [0]), 11);
    assert.equal(runExport(wat, "run", [2]), 33);
    assert.equal(runExport(wat, "run", [4]), 55);
  });

  // Arrays of bool / string / fn-ref are natural extensions of i32[]/f32[].
  maybeTest("bool[] is a supported array type", () => {
    const wat = compile(`
      export fn run(): i32 {
        let a: bool[] = [true, false, true];
        if (a[0]) { return 1; }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  maybeTest("string[] is a supported array type", () => {
    const wat = compile(`
      export fn run(): i32 {
        let a: string[] = ["foo", "bar"];
        return a[0].len;
      }
    `);
    assert.equal(runExport(wat, "run"), 3);
  });

  // Two-dimensional arrays are a common shape.
  test("i32[][] is an accepted type annotation", () => {
    const p = new Parser(`
      fn f(): i32 {
        let a: i32[][] = [[1, 2], [3, 4]];
        return a[1][0];
      }
    `);
    p.parse("test");
    assert.equal(p.errors.length, 0, `parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  });

  // `.len` works for strings; arrays should expose the same thing.
  maybeTest("arrays have a .len property", () => {
    const wat = compile(`
      export fn run(): i32 {
        let a: i32[] = [10, 20, 30, 40];
        return a.len;
      }
    `);
    assert.equal(runExport(wat, "run"), 4);
  });

  // The parser used to limit array-literal elements to bare numeric/bool
  // literals. With struct-literal-as-expression support, an array of structs
  // should also parse.
  test("array literal of struct literals parses", () => {
    const p = new Parser(`
      struct P { x: i32 }
      fn f(): i32 {
        let arr: P[] = [{ x = 1 }, { x = 2 }];
        return arr[1].x;
      }
    `);
    p.parse("test");
    assert.equal(p.errors.length, 0, `parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  });

  test("array literal of i64 with `as i64` casts parses", () => {
    const p = new Parser(`
      fn f(): i32 {
        let arr: i64[] = [1 as i64, 2 as i64];
        return arr[1] as i32;
      }
    `);
    p.parse("test");
    assert.equal(p.errors.length, 0, `parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  });

  // Inline array-literal expression with immediate index.
  test("indexing an inline array literal parses", () => {
    const p = new Parser(`
      fn f(): i32 { return [10, 20, 30][1]; }
    `);
    p.parse("test");
    assert.equal(p.errors.length, 0, `parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  });

  // Out-of-bounds and negative indices silently read adjacent memory today.
  // A safe implementation should trap or surface the issue.
  maybeTest("reading past the end of an array traps or returns a known value", () => {
    const wat = compile(`
      export fn run(): i32 {
        let a: i32[] = [1, 2, 3];
        return a[10];
      }
    `);
    let trapped = false;
    let value: unknown = null;
    try {
      value = runExport(wat, "run");
    } catch {
      trapped = true;
    }
    assert(trapped || value !== 0, `OOB read returned ${value} silently`);
  });

  maybeTest("negative array index traps or is rejected", () => {
    const wat = compile(`
      export fn run(): i32 {
        let a: i32[] = [1, 2, 3];
        return a[0 - 1];
      }
    `);
    let trapped = false;
    try {
      runExport(wat, "run");
    } catch {
      trapped = true;
    }
    assert(trapped, "negative array index should trap (or be rejected at compile time)");
  });
});

// ─── multi-return + destructuring with non-trivial inputs ──────────────────

describe("multi-return destructuring", () => {
  maybeTest("divmod with various dividend/divisor", () => {
    const wat = compile(`
      fn divmod(n: i32, d: i32): (i32, i32) { return n / d, n % d; }
      export fn quot(n: i32, d: i32): i32 {
        let (q, r) = divmod(n, d);
        return q;
      }
      export fn rem(n: i32, d: i32): i32 {
        let (q, r) = divmod(n, d);
        return r;
      }
    `);
    assert.equal(runExport(wat, "quot", [17, 5]), 3);
    assert.equal(runExport(wat, "rem", [17, 5]), 2);
    assert.equal(runExport(wat, "quot", [100, 7]), 14);
    assert.equal(runExport(wat, "rem", [100, 7]), 2);
  });

  maybeTest("swap returns both values", () => {
    const wat = compile(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      export fn fst(a: i32, b: i32): i32 {
        let (x, y) = swap(a, b);
        return x;
      }
      export fn snd(a: i32, b: i32): i32 {
        let (x, y) = swap(a, b);
        return y;
      }
    `);
    assert.equal(runExport(wat, "fst", [1, 2]), 2);
    assert.equal(runExport(wat, "snd", [1, 2]), 1);
  });

  maybeTest("discard with _ in destructure", () => {
    const wat = compile(`
      fn divmod(n: i32, d: i32): (i32, i32) { return n / d, n % d; }
      export fn run(): i32 {
        let (q, _) = divmod(20, 6);
        return q;
      }
    `);
    assert.equal(runExport(wat, "run"), 3);
  });
});

// ─── global variables ──────────────────────────────────────────────────────

describe("global variables", () => {
  maybeTest("global int mutated from function", () => {
    const wat = compile(`
      let counter: i32 = 0;
      fn tick(): void { counter = counter + 1; }
      export fn run(): i32 {
        tick();
        tick();
        tick();
        return counter;
      }
    `);
    assert.equal(runExport(wat, "run"), 3);
  });

  maybeTest("global with non-zero initializer", () => {
    const wat = compile(`
      let base: i32 = 100;
      export fn run(): i32 { return base + 5; }
    `);
    assert.equal(runExport(wat, "run"), 105);
  });

  maybeTest("const global cannot be re-assigned but reads work", () => {
    const wat = compile(`
      const FACTOR: i32 = 7;
      export fn run(n: i32): i32 { return n * FACTOR; }
    `);
    assert.equal(runExport(wat, "run", [6]), 42);
  });

  maybeTest("two globals coexist", () => {
    const wat = compile(`
      let a: i32 = 10;
      let b: i32 = 20;
      export fn run(): i32 { return a * b; }
    `);
    assert.equal(runExport(wat, "run"), 200);
  });

  // A global initializer that references another global compiles and reads
  // the referenced value. Currently fails at wat2wasm.
  maybeTest("a global initializer can reference another global", () => {
    const wat = compile(`
      let A: i32 = 10;
      let B: i32 = A + 5;
      export fn run(): i32 { return B; }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected: ${err}`);
  });
});

// ─── Comments ───────────────────────────────────────────────────────────────

describe("comments", () => {
  test("block comments /* ... */ are accepted", () => {
    const p = new Parser(`
      fn f(): i32 {
        /* multi-line
           comment */
        return 42;
      }
    `);
    p.parse("test");
    assert.equal(p.errors.length, 0, `parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  });

  // Comment content (including code-like text inside the comment) must not
  // influence the compiled program.
  maybeTest("block comment content is ignored at runtime", () => {
    const wat = compile(`
      export fn run(): i32 {
        /* return 999; */
        return 42;
      }
    `);
    assert.equal(runExport(wat, "run"), 42);
  });
});

// ─── Numeric literals ───────────────────────────────────────────────────────

describe("numeric literals", () => {
  // Underscores in numeric literals are common readability sugar in modern langs.
  maybeTest("underscores in numeric literals are accepted", () => {
    const wat = compile(`
      export fn run(): i32 { return 1_000_000; }
    `);
    assert.equal(runExport(wat, "run"), 1_000_000);
  });

  // `0b` and `0x` are both supported; `0o` is the obvious gap.
  maybeTest("octal literal 0o17 is accepted", () => {
    const wat = compile(`
      export fn run(): i32 { return 0o17; }
    `);
    assert.equal(runExport(wat, "run"), 15);
  });

  // Hex literals above 2^53 lose precision through `Number.parseInt`, then
  // emit an `(i32.const ...)` whose value isn't a valid integer.
  maybeTest("hex literal 0xFFFFFFFFFFFFFFFF compiles to a valid i64", () => {
    const wat = compile(`
      export fn run(): i64 {
        return 0xFFFFFFFFFFFFFFFF as i64;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected: ${err}`);
  });
});

// ─── Unary operators ────────────────────────────────────────────────────────

describe("unary operators", () => {
  test("unary plus +x is accepted", () => {
    const p = new Parser(`
      fn f(): i32 { return +5; }
    `);
    p.parse("test");
    assert.equal(p.errors.length, 0, `parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  });

  maybeTest("unary plus is a no-op at runtime", () => {
    const wat = compile(`
      export fn run(): i32 { return +5; }
      export fn negRun(): i32 { let x: i32 = 0 - 7; return +x; }
    `);
    assert.equal(runExport(wat, "run"), 5);
    assert.equal(runExport(wat, "negRun"), -7);
  });

  maybeTest("logical-not on i64 produces valid wasm and correct semantics", () => {
    const wat = compile(`
      export fn notZero(): i32 { let x: i64 = 0 as i64; if (!x) { return 1; } return 0; }
      export fn notOne(): i32  { let x: i64 = 1 as i64; if (!x) { return 1; } return 0; }
    `);
    assert.equal(runExport(wat, "notZero"), 1);
    assert.equal(runExport(wat, "notOne"), 0);
  });

  maybeTest("logical-not on f32 produces valid wasm and correct semantics", () => {
    const wat = compile(`
      export fn notZero(): i32 { let x: f32 = 0.0; if (!x) { return 1; } return 0; }
      export fn notOne(): i32  { let x: f32 = 1.0; if (!x) { return 1; } return 0; }
    `);
    assert.equal(runExport(wat, "notZero"), 1);
    assert.equal(runExport(wat, "notOne"), 0);
  });

  maybeTest("logical-not on f64 produces valid wasm and correct semantics", () => {
    const wat = compile(`
      export fn notZero(): i32 { let x: f64 = 0.0 as f64; if (!x) { return 1; } return 0; }
      export fn notOne(): i32  { let x: f64 = 1.0 as f64; if (!x) { return 1; } return 0; }
    `);
    assert.equal(runExport(wat, "notZero"), 1);
    assert.equal(runExport(wat, "notOne"), 0);
  });
});

// ─── Narrow integer casts ──────────────────────────────────────────────────
// Casting through a narrower type is the standard way to mask high bits.
// Currently `x as u8` is a no-op — the cast emits just `(local.get $x)`.

describe("narrow integer casts", () => {
  maybeTest("i32 -> u8 truncates to 8 bits", () => {
    const wat = compile(`
      export fn run(): i32 {
        let x: i32 = 300;
        let b: u8 = x as u8;
        return b as i32;
      }
    `);
    // 300 = 0x12C; low byte is 0x2C = 44.
    assert.equal(runExport(wat, "run"), 44);
  });

  maybeTest("i32 -> u16 truncates to 16 bits", () => {
    const wat = compile(`
      export fn run(): i32 {
        let x: i32 = 70000;
        let h: u16 = x as u16;
        return h as i32;
      }
    `);
    // 70000 & 0xFFFF = 4464.
    assert.equal(runExport(wat, "run"), 4464);
  });

  maybeTest("i32 -> i8 sign-extends from low byte", () => {
    const wat = compile(`
      export fn run(): i32 {
        let x: i32 = 200;
        let b: i8 = x as i8;
        return b as i32;
      }
    `);
    // 200 fits in u8; as i8 it's -56 (low byte interpreted signed).
    assert.equal(runExport(wat, "run"), -56);
  });
});

// ─── Switch statements ─────────────────────────────────────────────────────

describe("switch statements", () => {
  // The typechecker permits `switch (expr)` on f32; the emitter lowers to
  // `br_table` which requires an i32 discriminant. wat2wasm rejects.
  maybeTest("switch on f32 discriminant is either rejected or lowered correctly", () => {
    const wat = compile(`
      export fn run(): i32 {
        let x: f32 = 1.0;
        switch (x) {
          case 1: { return 10; }
          default: { return 0; }
        }
        return -1;
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected: ${err}`);
  });

  test("switch case can use a negative integer literal", () => {
    const p = new Parser(`
      fn f(x: i32): i32 {
        switch (x) {
          case -1: { return 100; }
          default: { return 0; }
        }
      }
    `);
    p.parse("test");
    assert.equal(p.errors.length, 0, `parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  });

  // The parser now accepts negative case literals but the emitter's br_table
  // only covers `[0..maxCase]`, so negative values fall through to default
  // instead of firing their case body.
  maybeTest("switch dispatches on a negative case value at runtime", () => {
    const wat = compile(`
      export fn run(x: i32): i32 {
        switch (x) {
          case -1: { return 100; }
          case 0:  { return 200; }
          default: { return 999; }
        }
        return -1;
      }
    `);
    assert.equal(runExport(wat, "run", [-1]), 100);
    assert.equal(runExport(wat, "run", [0]), 200);
    assert.equal(runExport(wat, "run", [5]), 999);
  });

  // Switch on f32 is coerced to i32 via `i32.trunc_f32_s`, so the case
  // bodies fire for values whose truncation matches.
  maybeTest("switch on f32 dispatches on the truncated integer value", () => {
    const wat = compile(`
      export fn run(x: f32): i32 {
        switch (x) {
          case 1: { return 100; }
          case 2: { return 200; }
          default: { return 0; }
        }
        return -1;
      }
    `);
    assert.equal(runExport(wat, "run", [1.0]), 100);
    assert.equal(runExport(wat, "run", [1.9]), 100); // trunc(1.9) == 1
    assert.equal(runExport(wat, "run", [2.5]), 200);
    assert.equal(runExport(wat, "run", [9.0]), 0);
  });

  // Switch emits one br_table entry per index in [0..maxCase]. A high case
  // value causes the emitted WAT to balloon (a 1M case produces ~18 MB of text).
  test("switch with sparse high case value does not balloon br_table", () => {
    const wat = compile(`
      fn dispatch(x: i32): i32 {
        switch (x) {
          case 1: { return 1; }
          case 1000000: { return 999; }
          default: { return 0; }
        }
        return -1;
      }
    `);
    assert(wat.length < 50_000, `WAT for a 2-case switch ballooned to ${wat.length} chars`);
  });
});

// ─── String semantics ──────────────────────────────────────────────────────

describe("string semantics", () => {
  // String comparison compares pointer values, not content.
  maybeTest("two identical string literals are equal under ==", () => {
    const wat = compile(`
      export fn run(): i32 {
        let a: string = "hello";
        let b: string = "hello";
        if (a == b) { return 1; }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  // stdlib.ts declares `string_copy` with the wrong arity. The actual WAT
  // takes (i32, i32) and returns nothing.
  maybeTest("string_copy import matches its real (src, dst) -> void signature", () => {
    const wat = compile(`
      import string_copy from "string"
      export fn run(): void {
        let src: string = "hello";
        let dst: string = "world";
        string_copy(src, dst);
      }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected: ${err}`);
  });
});

// ─── Lexical scoping ───────────────────────────────────────────────────────
// `let` declarations currently share a single per-function symbol table, so
// shadowing in nested blocks silently clobbers the outer binding.

describe("lexical scoping", () => {
  // Inner-block `let` should shadow, not clobber.
  maybeTest("inner-block let shadows outer let", () => {
    const wat = compile(`
      export fn run(): i32 {
        let x: i32 = 1;
        if (1 == 1) {
          let x: i32 = 99;
        }
        return x;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  // Two for-loops with the same counter name should iterate independently.
  // Today the inner loop clobbers the outer counter, so the outer runs once.
  maybeTest("nested for-loops with same counter name iterate independently", () => {
    const wat = compile(`
      export fn run(): i32 {
        let acc: i32 = 0;
        for (let i: i32 = 1; i < 3; i = i + 1) {
          for (let i: i32 = 10; i < 12; i = i + 1) {
            acc = acc + i;
          }
        }
        return acc;
      }
    `);
    // outer runs 2x; inner contributes 10+11 = 21 each → 42
    assert.equal(runExport(wat, "run"), 42);
  });

  // Parameter `x` and a body `let x` collide on the same WASM local name —
  // wat2wasm rejects with "redefinition of parameter".
  maybeTest("let inside fn body can shadow a parameter", () => {
    const wat = compile(`
      fn f(x: i32): i32 {
        let x: i32 = 99;
        return x;
      }
      export fn run(): i32 { return f(1); }
    `);
    const err = validateWithWat2Wasm(wat);
    assert.equal(err, null, `wat2wasm rejected: ${err}`);
  });
});

// ─── Parser robustness ─────────────────────────────────────────────────────
// Invariant: any input — valid or not — produces a finite error message.
// The parser must never hang or exhaust memory.

describe("parser robustness", () => {
  // A labeled statement (e.g. `outer: for (...)`) makes the parser loop
  // indefinitely. Run in a subprocess with a hard timeout so the test can't
  // hang the suite itself.
  test("labeled statement does not hang the parser", () => {
    const parserPath = join(dirname(fileURLToPath(import.meta.url)), "../src/parser/Parser.ts");
    // tsx wraps CJS source so the dynamic import returns the original module
    // under either `default` or `"module.exports"`; pick whichever exposes
    // the Parser constructor.
    const script = `
      import(${JSON.stringify(parserPath)}).then((m) => {
        const Parser = m.Parser ?? m.default?.Parser ?? m["module.exports"]?.Parser;
        if (typeof Parser !== "function") { process.exit(2); }
        const p = new Parser(\`
          fn f(): i32 {
            outer: for (let i: i32 = 0; i < 5; i = i + 1) {
              for (let j: i32 = 0; j < 5; j = j + 1) {
                if (j == 2) { break outer; }
              }
            }
            return 1;
          }
        \`);
        p.parse("test");
        process.exit(0);
      });
    `;
    const result = spawnSync("npx", ["tsx", "-e", script], {
      timeout: 3000,
      encoding: "utf8",
    });
    // Through npx, a timeout shows up as `error.code === "ETIMEDOUT"` and an
    // exit status of 143 (128 + SIGTERM) rather than a SIGTERM `signal`.
    const timedOut =
      (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" ||
      result.signal === "SIGTERM" ||
      result.status === 143;
    if (result.status === 2) {
      assert.fail("subprocess could not resolve Parser constructor — test scaffolding broken");
    }
    assert.equal(
      timedOut,
      false,
      "parser ran past 3s wall-clock on a labeled-for input — likely infinite loop",
    );
  });
});
