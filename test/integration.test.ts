/**
 * Integration tests: compile Maple source all the way to WAT and verify
 * structural correctness (Level 1) and, when wat2wasm is available on PATH,
 * binary validity (Level 2).
 *
 * Level 1 – pure TypeScript, no external tools needed.
 * Level 2 – shells out to `wat2wasm`. Tests are skipped if the binary is absent.
 */
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { emitModule, extractModuleMeta } from "../src/compiler/emitters/module";
import { Parser } from "../src/parser/Parser";

// ─── helpers ───────────────────────────────────────────────────────────────

function compile(src: string): string {
  const p = new Parser(src);
  const ast = p.parse("integration");
  assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  const meta = extractModuleMeta(ast);
  return emitModule(ast, meta).buildWat();
}

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

/** Returns true if wat2wasm is available on PATH */
function hasWat2Wasm(): boolean {
  try {
    execSync("wat2wasm --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Validate WAT with wat2wasm; returns null on success or an error string */
function validateWithWat2Wasm(wat: string): string | null {
  const dir = join(tmpdir(), `maple-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const watFile = join(dir, "out.wat");
  const wasmFile = join(dir, "out.wasm");
  writeFileSync(watFile, wat);
  try {
    const result = spawnSync("wat2wasm", [watFile, "-o", wasmFile], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      return result.stderr ?? "wat2wasm failed";
    }
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const wat2wasmAvailable = hasWat2Wasm();
function maybeTest(name: string, fn: () => void) {
  if (wat2wasmAvailable) {
    test(name, fn);
  } else {
    test.skip(`[needs wat2wasm] ${name}`, fn);
  }
}

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
    assert(wat.includes("br_table"));
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
});

// ─── 8A: Memory-Backed Local Structs — Integration ─────────────────────────

describe("Integration: 8A local struct wat2wasm validation", () => {
  maybeTest("P64: local struct — create, read field, return passes wat2wasm", () => {
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

  maybeTest("P65: local struct with early return passes wat2wasm", () => {
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

  maybeTest("P66: two local structs — read from both passes wat2wasm", () => {
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

  maybeTest("P67: write-then-read local struct passes wat2wasm", () => {
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

  maybeTest("P68: loop with struct field read/write passes wat2wasm", () => {
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

  maybeTest("P69: method call on local struct passes wat2wasm", () => {
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

  maybeTest("P70: method with extra arg on local struct passes wat2wasm", () => {
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

  maybeTest("P71: f32 struct local — read f32 member passes wat2wasm", () => {
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

  maybeTest("P72: mixed i32/f32 struct local passes wat2wasm", () => {
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

  maybeTest("P73: void function with local struct passes wat2wasm", () => {
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

  maybeTest("P74: nested function calls — both with local structs passes wat2wasm", () => {
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

  maybeTest("P76: existing struct param and member access still passes wat2wasm", () => {
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
