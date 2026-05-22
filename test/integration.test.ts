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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { linkStdlibImports } from "../src/compiler/compiler";
import {
  collectFnReferences,
  emitModule,
  extractModuleMeta,
} from "../src/compiler/emitters/module";
import { Parser } from "../src/parser/Parser";

// ─── helpers ───────────────────────────────────────────────────────────────

function compile(src: string): string {
  const p = new Parser(src);
  const ast = p.parse("integration");
  assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
  const meta = extractModuleMeta(ast);
  collectFnReferences(ast, meta);
  linkStdlibImports(meta);
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

/**
 * Assemble WAT with wat2wasm, instantiate, invoke an export, return its value.
 * Assumes the module only imports "runtime" "memory" (true for Maple modules
 * without stdlib calls). Caller must gate with wat2wasmAvailable.
 */
function runExport(wat: string, fnName: string, args: number[] = []): unknown {
  const dir = join(tmpdir(), `maple-run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const watFile = join(dir, "out.wat");
  const wasmFile = join(dir, "out.wasm");
  writeFileSync(watFile, wat);
  try {
    const asm = spawnSync("wat2wasm", [watFile, "-o", wasmFile], { encoding: "utf8" });
    if (asm.status !== 0) {
      throw new Error(`wat2wasm failed: ${asm.stderr}`);
    }
    const bytes = readFileSync(wasmFile);
    const mod = new WebAssembly.Module(bytes);
    const memory = new WebAssembly.Memory({ initial: 2 });
    const inst = new WebAssembly.Instance(mod, { runtime: { memory } });
    const fn = inst.exports[fnName];
    if (typeof fn !== "function") {
      throw new Error(`export ${fnName} is not a function`);
    }
    return (fn as (...a: number[]) => unknown)(...args);
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

// ─── 8A: Memory-Backed Local Structs — Integration ─────────────────────────

describe("Integration: 8A local struct wat2wasm validation", () => {
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
    const calls = wat.match(/\(call \$produce[^\)]*\)\s*\(drop\)/g) ?? [];
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
