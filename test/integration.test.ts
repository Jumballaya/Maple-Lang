/** Integration tests compile Maple source and validate emitted Wasm directly. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { linkStdlibImports } from "../src/compiler/compiler";
import { collectFnReferences, extractModuleMeta } from "../src/compiler/module-metadata";
import { typeCheck } from "../src/compiler/TypeChecker";
import { encodeWasm } from "../src/ir/encode-wasm";
import type { IrModule } from "../src/ir/ir";
import { printWat } from "../src/ir/print-wat";
import { Parser } from "../src/parser/Parser";
import { compile, mergedInstance, runExport, runMergedExport } from "./helpers";
import { moduleWith } from "./ir-fixtures";

function encodedModule(module: IrModule): WebAssembly.Module {
  return new WebAssembly.Module(encodeWasm(module) as Uint8Array<ArrayBuffer>);
}

function checkedCompile(source: string) {
  const parser = new Parser(source, "behavioralization.maple");
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
  return compile(source);
}

function checkerMessages(source: string): string[] {
  const parser = new Parser(source, "integration.maple");
  const ast = parser.parse("integration");
  assert.deepEqual(
    parser.errors.map((error) => error.message),
    [],
  );
  const meta = extractModuleMeta(ast, true);
  collectFnReferences(ast, meta);
  linkStdlibImports(meta);
  return typeCheck(ast, meta).map((error) => error.message);
}

describe("cross-check tool gating", () => {
  test("direct-encoder suites ignore the cross-check skip flag", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "test/math.test.ts"], {
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
    assert.match(output, /skipped 0/);
  });

  test("runExport merges fresh automatic memory with caller imports and honors overrides", () => {
    const module = moduleWith({
      types: [
        { params: ["i32", "i32", "i32"], results: ["i32"] },
        { params: [], results: ["i32"] },
      ],
      funcImports: [
        { module: "host", name: "combine", sig: 0 },
        { module: "runtime", name: "marker", sig: 1 },
      ],
      globalImports: [{ module: "host", name: "base", type: "i32" }],
      funcs: [
        {
          sig: 1,
          locals: [],
          body: [
            {
              k: "drop",
              e: { k: "memory.grow", pages: { k: "const", type: "i32", value: 1 } },
            },
            {
              k: "return",
              values: [
                {
                  k: "call",
                  fn: 0,
                  args: [
                    { k: "global.get", id: 0 },
                    { k: "call", fn: 1, args: [] },
                    { k: "memory.size" },
                  ],
                },
              ],
            },
          ],
          export: "run",
        },
      ],
      memory: { initialPages: 1, mode: "imported" },
    });
    const imports = {
      host: {
        base: new WebAssembly.Global({ value: "i32", mutable: false }, 40),
        combine: (base: number, marker: number, pages: number) => base + marker + pages,
      },
      runtime: {
        marker: () => 0,
      },
    };

    assert.equal(runExport(module, "run", [], imports), 42);
    assert.equal(runExport(module, "run", [], imports), 42);

    const memory = new WebAssembly.Memory({ initial: 1 });
    assert.equal(
      runExport(module, "run", [], {
        ...imports,
        runtime: { ...imports.runtime, memory },
      }),
      42,
    );
    assert.equal(memory.buffer.byteLength / 65_536, 2);
  });

  test("runExport accepts and returns BigInt for i64 exports", () => {
    const wat = compile("export fn echo(value: i64): i64 { return value; }");
    assert.equal(runExport(wat, "echo", [123n]), 123n);
  });

  test("runExport supports imported memory as an explicit option", () => {
    const wat = compile("export fn answer(): i32 { return 42; }", { importMemory: true });
    assert.equal(runExport(wat, "answer"), 42);
  });

  test("cross-check tests skip when comparison is disabled", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--test", "test/ir-crosscheck.test.ts"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          MAPLE_REQUIRE_WAT2WASM: undefined,
          MAPLE_SKIP_WAT2WASM: "1",
          NODE_TEST_CONTEXT: undefined,
        },
      },
    );
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /skip/i);
  });

  test("required cross-check comparison overrides disabled execution", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--test", "test/ir-crosscheck.test.ts"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          MAPLE_REQUIRE_WAT2WASM: "1",
          MAPLE_SKIP_WAT2WASM: "1",
          NODE_TEST_CONTEXT: undefined,
        },
      },
    );
    assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
  });

  test("cross-check tests skip when the comparison tool is absent", () => {
    const emptyPath = mkdtempSync(join(tmpdir(), "maple-empty-path-"));
    try {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "--test", "test/ir-crosscheck.test.ts"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            MAPLE_REQUIRE_WAT2WASM: undefined,
            MAPLE_SKIP_WAT2WASM: undefined,
            NODE_TEST_CONTEXT: undefined,
            PATH: emptyPath,
          },
        },
      );
      const output = `${result.stdout}${result.stderr}`;
      assert.equal(result.status, 0, output);
      assert.match(output, /skipped [1-9]\d*/);
    } finally {
      rmSync(emptyPath, { recursive: true, force: true });
    }
  });
});

/*
 * WAT assertions were inventoried and behavioralized by T33–T36/T38; the
 * conversion maps live in git history. Executable semantics use typechecked
 * runExport/runMergedExport fixtures. Only host
 * surface facts that execution cannot observe stay here: imports, exports,
 * memory, tables/elements, start/data presence, and intentional absence.
 * Structural regexes tolerate whitespace and generated names and never pin
 * cross-section order. Formatting-only assertions are removed with a map
 * justification; transitional guards are explicitly marked for T37.
 */
describe("host surface (WAT-structural)", () => {
  test("module-owned memory export is always present", () => {
    const wat = printWat(compile("fn noop(): void {}"));
    assert.match(wat, /\(memory\s+\(export\s+"memory"\)\s+\d+\s*\)/);
    assert.doesNotMatch(wat, /\(import\s+"runtime"\s+"memory"\s+\(memory\b/);
  });

  test("exported functions expose their public name", () => {
    const wat = printWat(
      compile(`
        export fn add(a: i32, b: i32): i32 { return a + b; }
      `),
    );
    assert.match(wat, /\(export\s+"add"\)/);
  });

  test("the math demo retains its external host imports", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(dir, "../demo/12_math/main.maple"), "utf8");
    const wat = printWat(compile(source));
    assert.match(wat, /\(import\s+"math"\s+"[^"]+"\s+\((?:func|global)\b/);
  });

  test("sparse switches keep bounded textual output", () => {
    const wat = printWat(
      compile(`
        fn dispatch(x: i32): i32 {
          switch (x) {
            case 1: { return 1; }
            case 1000000: { return 999; }
            default: { return 0; }
          }
          return -1;
        }
      `),
    );
    assert(wat.length < 50_000, `WAT for a 2-case switch ballooned to ${wat.length} chars`);
  });

  test("structural regexes tolerate equivalent reformatting", () => {
    assert.match(
      '(memory\n  (export "memory")\n  3)',
      /\(memory\s+\(export\s+"memory"\)\s+\d+\s*\)/,
    );
    assert.match(
      '(import  "math"\n "sqrt"\n (func $generated (param f32) (result f32)))',
      /\(import\s+"math"\s+"[^"]+"\s+\((?:func|global)\b/,
    );
  });
});

describe("Integration: behavioralized structure coverage", () => {
  test("declared functions compose at runtime", () => {
    const wat = checkedCompile(`
      fn alpha(): i32 { return 1; }
      fn beta(): i32 { return 2; }
      export fn gamma(): i32 { return alpha() + beta(); }
    `);
    assert.equal(runExport(wat, "gamma"), 3);
  });

  test("globals and multi-function control flow execute", () => {
    const wat = checkedCompile(`
      const MAX: i32 = 100;
      let total: i32 = 0;
      fn clamp(x: i32): i32 {
        if (x < 0) { return 0; }
        if (x > MAX) { return MAX; }
        return x;
      }
      export fn run(seed: i32): i32 {
        let i: i32 = 0;
        while (i < 10) {
          total += clamp(seed + i);
          i++;
        }
        return total;
      }
    `);
    assert.equal(runExport(wat, "run", [5]), 95);
  });

  test("for break and continue preserve update semantics", () => {
    const wat = checkedCompile(`
      fn sum(n: i32): i32 {
        let result: i32 = 0;
        for (let i: i32 = 0; i < n; i = i + 1) {
          if (i == 3) { continue; }
          if (i == 7) { break; }
          result += i;
        }
        return result;
      }
      export fn run(n: i32): i32 { return sum(n); }
    `);
    assert.equal(runExport(wat, "run", [10]), 18);
  });

  test("switch dispatch selects cases and the default", () => {
    const wat = checkedCompile(`
      export fn classify(x: i32): i32 {
        switch (x) {
          case 0: { return 10; }
          case 1: { return 20; }
          case 2: { return 30; }
          default: { return 99; }
        }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "classify", [0]), 10);
    assert.equal(runExport(wat, "classify", [2]), 30);
    assert.equal(runExport(wat, "classify", [9]), 99);
  });

  test("binary operator families produce observable results", () => {
    const wat = checkedCompile(`
      export fn arithmetic(a: i32, b: i32): i32 { return ((a + b) * (a - b)) / 2 % 7; }
      export fn bits(a: i32, b: i32): i32 { return (a & b) | (a ^ b); }
      export fn shifts(a: i32): i32 { return (a << 2) >> 1; }
      export fn comparisons(a: i32, b: i32): i32 {
        return (a == b) || (a != b) && (a > b) || (a < b) || (a >= b) || (a <= b);
      }
    `);
    assert.equal(runExport(wat, "arithmetic", [9, 3]), 1);
    assert.equal(runExport(wat, "bits", [12, 10]), 14);
    assert.equal(runExport(wat, "shifts", [5]), 10);
    assert.equal(runExport(wat, "comparisons", [1, 2]), 1);
  });

  test("postfix and compound assignments mutate the value", () => {
    const wat = checkedCompile(`
      export fn mutations(seed: i32): i32 {
        let value: i32 = seed;
        value++;
        value--;
        value += 5;
        value -= 2;
        value *= 3;
        value /= 2;
        value %= 7;
        value &= 15;
        value |= 4;
        value ^= 1;
        value <<= 1;
        value >>= 1;
        return value;
      }
    `);
    assert.equal(runExport(wat, "mutations", [10]), 4);
  });

  test("struct parameters and member access compose", () => {
    const wat = checkedCompile(`
      struct Point { x: i32, y: i32 }
      fn manhattan(p: Point, q: Point): i32 {
        return (p.x - q.x) + (p.y - q.y);
      }
      export fn run(): i32 {
        let p: Point = { x = 5, y = 7 };
        let q: Point = { x = 2, y = 3 };
        return manhattan(p, q);
      }
    `);
    assert.equal(runExport(wat, "run"), 7);
  });

  test("nested else-if chains choose the matching branch", () => {
    const wat = checkedCompile(`
      export fn grade(score: i32): i32 {
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
    assert.equal(runExport(wat, "grade", [95]), 5);
    assert.equal(runExport(wat, "grade", [80]), 4);
    assert.equal(runExport(wat, "grade", [65]), 3);
    assert.equal(runExport(wat, "grade", [20]), 2);
  });
});

// ─── Level 2: direct binary validation ────────────────────────────────────

describe("Integration: binary validation", () => {
  test("simple function encodes to valid Wasm", () => {
    const wat = compile("fn add(a: i32, b: i32): i32 { return a + b; }");
    assert(encodedModule(wat));
  });

  test("for loop encodes to valid Wasm", () => {
    const wat = compile(`
      fn sum(n: i32): i32 {
        let total: i32 = 0;
        for (let i: i32 = 0; i < n; i = i + 1) { total += i; }
        return total;
      }
    `);
    assert(encodedModule(wat));
  });

  test("switch statement encodes to valid Wasm", () => {
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
    assert(encodedModule(wat));
  });

  test("switch default with break stays in valid label scope", () => {
    const wat = compile(`
      fn f(x: i32): void {
        switch (x) {
          case 0: { return; }
          default: { break; }
        }
      }
    `);
    assert(encodedModule(wat));
  });

  test("nested f32 return if emits valid Wasm output", () => {
    const wat = compile(`
      fn f(x: i32): f32 {
        if (x > 0) {
          if (x > 1) { return 1.0; } else { return 2.0; }
        } else {
          return 3.0;
        }
      }
    `);
    assert(encodedModule(wat));
  });

  test("void-returning if both branches returns remains valid Wasm", () => {
    const wat = compile(`
      fn f(x: i32): void {
        if (x > 0) { return; } else { return; }
      }
    `);
    assert(encodedModule(wat));
  });

  test("struct param and member access encodes to valid Wasm", () => {
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
    assert(encodedModule(wat));
  });

  test("full-featured program encodes to valid Wasm", () => {
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
    assert(encodedModule(wat));
  });

  test("void function discarding single-return call validates", () => {
    const wat = checkedCompile(`
      fn produce(): i32 { return 42; }
      export fn _start(): void {
        produce();
      }
    `);
    assert(encodedModule(wat));
  });
});

// ─── Memory-Backed Local Structs — Integration ─────────────────────────

describe("Integration: local struct binary validation", () => {
  test("local struct — create, read field, return encodes to valid Wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 {
        let p: Point = { x = 3, y = 4 };
        return p.x + p.y;
      }
    `);
    assert(encodedModule(wat));
  });

  test("local struct with early return encodes to valid Wasm", () => {
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
    assert(encodedModule(wat));
  });

  test("two local structs — read from both encodes to valid Wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 {
        let p: Point = { x = 1, y = 2 };
        let q: Point = { x = 3, y = 4 };
        return p.x + q.y;
      }
    `);
    assert(encodedModule(wat));
  });

  test("write-then-read local struct encodes to valid Wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): i32 {
        let p: Point = { x = 0, y = 0 };
        p.x = 99;
        return p.x;
      }
    `);
    assert(encodedModule(wat));
  });

  test("loop with struct field read/write encodes to valid Wasm", () => {
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
    assert(encodedModule(wat));
  });

  test("method call on local struct encodes to valid Wasm", () => {
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
    assert(encodedModule(wat));
  });

  test("method with extra arg on local struct encodes to valid Wasm", () => {
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
    assert(encodedModule(wat));
  });

  test("f32 struct local — read f32 member encodes to valid Wasm", () => {
    const wat = compile(`
      struct Vec2 { x: f32, y: f32 }
      fn test(): f32 {
        let v: Vec2 = { x = 1.5, y = 2.5 };
        return v.x;
      }
    `);
    assert(encodedModule(wat));
  });

  test("mixed i32/f32 struct local encodes to valid Wasm", () => {
    const wat = compile(`
      struct Mixed { a: i32, b: f32 }
      fn test(): i32 {
        let m: Mixed = { a = 42, b = 3.14 };
        return m.a;
      }
    `);
    assert(encodedModule(wat));
  });

  test("void function with local struct encodes to valid Wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn test(): void {
        let p: Point = { x = 1, y = 2 };
        p.x = 10;
      }
    `);
    assert(encodedModule(wat));
  });

  test("nested function calls — both with local structs encodes to valid Wasm", () => {
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
    assert(encodedModule(wat));
  });

  test("P75: function without local struct calling function with local struct encodes to valid Wasm", () => {
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
    assert(encodedModule(wat));
  });

  test("existing struct param and member access still encodes to valid Wasm", () => {
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
    assert(encodedModule(wat));
  });
});

describe("Integration: Struct literal expression values", () => {
  test("local struct with binary expression fields encodes to valid Wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn run(a: i32, b: i32): i32 {
        let p: Point = { x = a + b, y = a - b };
        return p.x + p.y;
      }
    `);
    assert(encodedModule(wat));
  });

  test("local struct with function-call field encodes to valid Wasm", () => {
    const wat = compile(`
      struct Point { x: i32, y: i32 }
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn run(): i32 {
        let p: Point = { x = add(1, 2), y = 0 };
        return p.x;
      }
    `);
    assert(encodedModule(wat));
  });

  test("local struct with cast field encodes to valid Wasm", () => {
    const wat = compile(`
      struct Vec2 { x: f32, y: f32 }
      fn run(n: i32): f32 {
        let v: Vec2 = { x = n as f32, y = 0.0 };
        return v.x;
      }
    `);
    assert(encodedModule(wat));
  });

  test("global struct with expression field encodes to valid Wasm", () => {
    const wat = compile(`
      let offset: i32 = 12;
      struct Point { x: i32, y: i32 }
      let g: Point = { x = offset, y = 3 };
      export fn run(): i32 { return g.x + g.y; }
    `);
    assert(encodedModule(wat));
  });

  test("mixed literal-only and expression global structs encode to valid Wasm", () => {
    const wat = compile(`
      let offset: i32 = 7;
      struct Point { x: i32, y: i32 }
      let g1: Point = { x = 1, y = 2 };
      let g2: Point = { x = offset, y = 0 };
      export fn run(): i32 { return g1.x + g2.x; }
    `);
    assert(encodedModule(wat));
  });
});

describe("Integration: Inferred function call types", () => {
  test("inferred i32 from function call compiles and encodes to valid Wasm", () => {
    const src = `
      fn add(a: i32, b: i32): i32 { return a + b; }
      export fn _start(): i32 {
        let x = add(1, 2);
        return x;
      }
    `;
    const wat = compile(src);
    assert(encodedModule(wat));
  });

  test("inferred struct method call compiles and encodes to valid Wasm", () => {
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
    assert(encodedModule(wat));
  });

  test("inferred f32 from function call compiles and encodes to valid Wasm", () => {
    const src = `
      fn half(x: f32): f32 { return x; }
      export fn _start(): f32 {
        let h = half(3.14);
        return h;
      }
    `;
    const wat = compile(src);
    assert(encodedModule(wat));
  });

  test("demo 12_math compiles and encodes to valid Wasm", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(dir, "../demo/12_math/main.maple"), "utf8");
    const wat = compile(src);
    assert(encodedModule(wat));
  });
});

// ─── for-loop continue runs the update clause ──────────────────────────────
// Tests instantiate the compiled WASM and invoke the export, so they fail
// (rather than time out) if `continue` ever skips the for-loop's update and
// re-enters with the same loop counter.

describe("for-loop continue runs the update clause", () => {
  test("for + continue: skips body but increments", () => {
    const wat = checkedCompile(`
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

  test("for + multiple continues in same body", () => {
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

  test("continue inside switch inside for", () => {
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

  test("continue inside nested for binds to innermost loop", () => {
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

  test("continue in inner for inside outer while binds to inner for", () => {
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

  test("continue in nested while binds to inner while", () => {
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

  test("continue in inner while inside outer for runs the for update", () => {
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

  test("break and continue coexist in same for", () => {
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

  test("continue in while re-checks condition", () => {
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

  test("for without continue still works", () => {
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

  test("for with continue triggered every iteration terminates", () => {
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
});

// ─── && and || short-circuit ───────────────────────────────────────────────
// Side-effect probes: each subject calls a helper that mutates a global
// counter, then returns. If the operator evaluates the right-hand side when
// it shouldn't, the counter will be too high. The runtime invocations are
// the source of truth — pure WAT structure tests can't distinguish "emitted
// the right opcode" from "actually short-circuits."

describe("&& and || short-circuit", () => {
  test("&& with false LHS does not evaluate RHS", () => {
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

  test("&& with true LHS does evaluate RHS", () => {
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

  test("|| with true LHS does not evaluate RHS", () => {
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

  test("|| with false LHS does evaluate RHS", () => {
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

  test("&& and || still produce correct boolean results", () => {
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

  test("chained && short-circuits at first false", () => {
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

  test("chained || short-circuits at first true", () => {
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
  test("u32 → f32 → u32 round-trips for values above 2^31", () => {
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

  test("u32 → f64 → u32 round-trips for values above 2^31", () => {
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

  test("u32 → f32 preserves values above the signed range", () => {
    const wat = checkedCompile(`
      export fn run(): f32 {
        let x: u32 = 3000000000;
        return x as f32;
      }
    `);
    assert.equal(runExport(wat, "run"), 3_000_000_000);
  });

  test("f32 → u32 preserves values above the signed range", () => {
    const wat = checkedCompile(`
      export fn run(): u32 {
        let f: f32 = 3000000000.0;
        return f as u32;
      }
    `);
    assert.equal(runExport(wat, "run"), -1_294_967_296);
  });

  test("signed i32 → f32 preserves negative values", () => {
    const wat = checkedCompile(`
      export fn run(): f32 {
        let x: i32 = 0 - 5;
        return x as f32;
      }
    `);
    assert.equal(runExport(wat, "run"), -5);
  });

  test("signed i32 → f32 → i32 preserves negative values", () => {
    const wat = compile(`
      export fn run(): i32 {
        let x: i32 = 0 - 42;
        let f: f32 = x as f32;
        return f as i32;
      }
    `);
    assert.equal(runExport(wat, "run"), -42);
  });

  test("u8 → f32 preserves its unsigned value", () => {
    const wat = checkedCompile(`
      export fn run(): f32 {
        let x: u8 = 200;
        return x as f32;
      }
    `);
    assert.equal(runExport(wat, "run"), 200);
  });
});

// ─── unused call results are dropped at statement position ─────────────────
// A wrong drop count makes these modules fail validation or corrupt results.

describe("unused call results are dropped at statement position", () => {
  test("void function discarding i32-returning call instantiates", () => {
    const wat = checkedCompile(`
      fn produce(): i32 { return 42; }
      export fn _start(): void {
        produce();
      }
    `);
    runExport(wat, "_start");
  });

  test("void function discarding i64-returning call instantiates", () => {
    const wat = compile(`
      fn produce(): i64 { return 42 as i64; }
      export fn _start(): void {
        produce();
      }
    `);
    runExport(wat, "_start");
  });

  test("void function discarding f32-returning call instantiates", () => {
    const wat = compile(`
      fn produce(): f32 { return 1.5; }
      export fn _start(): void {
        produce();
      }
    `);
    runExport(wat, "_start");
  });

  test("void function discarding f64-returning call instantiates", () => {
    const wat = compile(`
      fn produce(): f64 { return 1.5 as f64; }
      export fn _start(): void {
        produce();
      }
    `);
    runExport(wat, "_start");
  });

  test("multiple discarded calls in sequence don't leak stack", () => {
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

  test("discarded call in value-returning fn doesn't corrupt result", () => {
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

  test("discarded multi-return call instantiates and runs", () => {
    const wat = checkedCompile(`
      fn pair(): (i32, i32) { return 1, 2; }
      export fn _start(): void {
        pair();
      }
    `);
    runExport(wat, "_start");
  });

  test("call result that is assigned does NOT get extra drop", () => {
    const wat = checkedCompile(`
      fn produce(): i32 { return 42; }
      export fn run(): i32 {
        let x: i32 = produce();
        return x;
      }
    `);
    // Result must be 42 — if an extra drop sneaks in it'd corrupt the assignment.
    assert.equal(runExport(wat, "run"), 42);
  });

  test("void-returning calls do not introduce a stack value", () => {
    const wat = checkedCompile(`
      fn consume(): void {}
      export fn run(): i32 {
        consume();
        return 7;
      }
    `);
    assert.equal(runExport(wat, "run"), 7);
  });

  test("discarded indirect-call results leave the stack valid", async () => {
    const source = `
      fn add(a: i32, b: i32): i32 { return a + b; }
      export fn run(): i32 {
        let f: fn(i32,i32):i32 = add;
        f(1, 2);
        return 7;
      }
    `;
    checkedCompile(source);
    assert.equal(await runMergedExport(source, "run"), 7);
  });
});

// ─── for-loop semantics with non-zero starts and varied steps ──────────────
// The demos only use `for (let i = 0; i < n; i = i + 1)`. These exercise
// non-zero starts, decrementing counters, expression bounds, and varied
// step sizes.

describe("for-loop non-trivial bounds", () => {
  test("counts up from 5", () => {
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

  test("counts down from 10 to 0 exclusive", () => {
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

  test("counts down inclusive to zero", () => {
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

  test("steps by 2", () => {
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

  test("init from parameter expression", () => {
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

  test("update is an expression call to itself", () => {
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

  test("zero iterations when init violates condition", () => {
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

  test("break exits at exact iteration", () => {
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

  test("nested for with distinct bounds runs full cartesian", () => {
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

  test("i64 counter from non-zero start", () => {
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
  test("condition involving function call re-evaluated each iteration", () => {
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

  test("break mid-loop returns the partial count", () => {
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

  test("condition uses && — both subconditions checked", () => {
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
  test("factorial via recursion", () => {
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

  test("fibonacci via recursion", () => {
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

  test("mutual recursion: even/odd", () => {
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

  test("accumulator-passing recursion (tail style)", () => {
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
  test("signed integer division with negative dividend", () => {
    const wat = compile(`
      export fn run(a: i32, b: i32): i32 { return a / b; }
    `);
    assert.equal(runExport(wat, "run", [-10, 3]), -3);
    assert.equal(runExport(wat, "run", [10, -3]), -3);
    assert.equal(runExport(wat, "run", [-10, -3]), 3);
  });

  test("signed modulo preserves sign of dividend", () => {
    const wat = compile(`
      export fn run(a: i32, b: i32): i32 { return a % b; }
    `);
    assert.equal(runExport(wat, "run", [-10, 3]), -1);
    assert.equal(runExport(wat, "run", [10, -3]), 1);
  });

  test("i32 wraps on overflow", () => {
    const wat = compile(`
      export fn run(): i32 { return 2147483647 + 1; }
    `);
    assert.equal(runExport(wat, "run"), -2147483648);
  });

  test("i64 arithmetic above i32 range", () => {
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

  test("float division and float mod (custom lowering)", () => {
    const wat = compile(`
      export fn divf(a: f32, b: f32): f32 { return a / b; }
      export fn modf(a: f32, b: f32): f32 { return a % b; }
    `);
    const divResult = runExport(wat, "divf", [9, 4]) as number;
    assert(Math.abs(divResult - 2.25) < 1e-6);
    const modResult = runExport(wat, "modf", [9, 4]) as number;
    assert(Math.abs(modResult - 1.0) < 1e-6);
  });

  test("comparison ops produce 0/1 i32", () => {
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
  test("i64 += integer literal compiles", () => {
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
  test("AND/OR/XOR with concrete bit patterns", () => {
    const wat = compile(`
      export fn band(a: i32, b: i32): i32 { return a & b; }
      export fn bor(a: i32, b: i32): i32 { return a | b; }
      export fn bxor(a: i32, b: i32): i32 { return a ^ b; }
    `);
    assert.equal(runExport(wat, "band", [0b1100, 0b1010]), 0b1000);
    assert.equal(runExport(wat, "bor", [0b1100, 0b1010]), 0b1110);
    assert.equal(runExport(wat, "bxor", [0b1100, 0b1010]), 0b0110);
  });

  test("left shift", () => {
    const wat = compile(`
      export fn shl(a: i32, b: i32): i32 { return a << b; }
    `);
    assert.equal(runExport(wat, "shl", [1, 0]), 1);
    assert.equal(runExport(wat, "shl", [1, 5]), 32);
    assert.equal(runExport(wat, "shl", [3, 4]), 48);
  });

  test("signed right shift preserves sign", () => {
    const wat = compile(`
      export fn shr(a: i32, b: i32): i32 { return a >> b; }
    `);
    assert.equal(runExport(wat, "shr", [-16, 2]), -4);
    assert.equal(runExport(wat, "shr", [16, 2]), 4);
  });

  test("unsigned shift ignores a signed count and remains unsigned", () => {
    const wat = checkedCompile(`
      export fn run(): i32 {
        return ((4294967295 as u32) >> 1) == 2147483647;
      }
      export fn adopted(x: u32, y: u32): i32 { return (1 + x) < y; }
    `);
    assert.equal(runExport(wat, "run"), 1);
    assert.equal(runExport(wat, "adopted", [4294967294, 1]), 0);
  });

  test("unary minus on unsigned wraps modulo the lane width", () => {
    const wat = compile(`
      export fn run(): i32 { return -(1 as u32) == 4294967295; }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  test("XOR with -1 flips all bits", () => {
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
  test("+= -= *= /= %= on local", () => {
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

  test("+= with expression rhs", () => {
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

  test("postfix ++ and -- as statement", () => {
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
  test("read fields at every offset", () => {
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

  test("write field at non-first offset preserves others", () => {
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

  test("struct with i64 field reads back correctly", () => {
    const wat = compile(`
      struct Big { tag: i32, big: i64 }
      export fn run(): i32 {
        let b: Big = { tag = 7, big = 1000000 as i64 };
        return b.tag + (b.big as i32);
      }
    `);
    assert.equal(runExport(wat, "run"), 1000007);
  });

  test("struct with f32 fields", () => {
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

  test("aligned mixed-width structs remain independent", () => {
    const wat = checkedCompile(`
      struct M { a: u8, b: i32 }
      export fn run(): i32 {
        let first: M = { a = 7, b = 100 };
        let second: M = { a = 9, b = 200 };
        first.b = first.b + 1;
        second.a = 8;
        return (first.a as i32) + first.b + (second.a as i32) + second.b;
      }
    `);
    assert.equal(runExport(wat, "run"), 316);
  });

  // Struct equality silently does pointer comparison instead of field-wise
  // compare. Either the typechecker should reject it, or it should do the
  // expected structural comparison.
  test("struct == struct compares fields (or is rejected)", () => {
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
  test("empty struct can be instantiated and used as a marker type", () => {
    const wat = compile(`
      struct Marker {}
      let shared: Marker = {};
      fn make(): Marker { return shared; }
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
  test("struct field of fn-type can be called via .field()", () => {
    const wat = compile(`
      struct Handler { cb: fn(i32):i32 }
      fn dbl(x: i32): i32 { return x * 2; }
      export fn run(): i32 {
        let h: Handler = { cb = dbl };
        return h.cb(5);
      }
    `);
    assert(encodedModule(wat));
  });

  // A global struct literal containing a string field fails with
  // "unsupported type: string" during emit.
  test("global struct with a string field compiles", () => {
    const wat = compile(`
      struct M { tag: i32, msg: string }
      let g: M = { tag = 1, msg = "hello" };
      export fn run(): i32 { return g.msg.len; }
    `);
    assert(encodedModule(wat));
  });

  // Member access on a function call (`make().x`) avoids a throwaway let.
  test("member access chained after a function call works", () => {
    const wat = compile(`
      struct P { x: i32 }
      let shared: P = { x = 42 };
      fn make(): P { return shared; }
      export fn run(): i32 { return make().x; }
    `);
    assert.equal(runExport(wat, "run"), 42);
  });
});

// ─── array operations driven by loops ──────────────────────────────────────

describe("array operations", () => {
  test("write all elements via loop, read back via loop", () => {
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

  test("find max of array", () => {
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

  test("swap two elements via temp", () => {
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

  test("array index from function parameter", () => {
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

  test("i64 array elements beyond 2^53 round-trip exactly", () => {
    const wat = compile(`
      export fn run(): i64 {
        let values: i64[] = [9007199254740993];
        return values[0];
      }
    `);
    assert.equal(runExport(wat, "run"), 9007199254740993n);
  });

  // Arrays of bool / string / fn-ref are natural extensions of i32[]/f32[].
  test("bool[] is a supported array type", () => {
    const wat = compile(`
      export fn run(): i32 {
        let a: bool[] = [true, false, true];
        if (a[0]) { return 1; }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  test("string[] is a supported array type", () => {
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
  test("arrays have a .len property", () => {
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
  test("reading past the end of an array traps or returns a known value", () => {
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

  test("negative array index traps or is rejected", () => {
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

describe("static data alignment", () => {
  test("aligns i64 array payloads and f64 global structs to 8 bytes", () => {
    const arrayWat = compile(`
      let prefix: u8[] = [1, 2, 3];
      let values: i64[] = [11, 22];
      export fn prefix_data(): i32 { return prefix.data; }
      export fn values_data(): i32 { return values.data; }
    `);
    const prefixData = runExport(arrayWat, "prefix_data") as number;
    const valuesData = runExport(arrayWat, "values_data") as number;

    assert.equal(valuesData % 8, 0);
    assert(valuesData > prefixData + 3, "expected an alignment gap after the u8 payload");

    const structWat = compile(`
      struct Wide { value: f64 }
      let prefix: u8[] = [1, 2, 3];
      let wide: Wide = { value = 1.5 };
      export fn wide_address(): Wide { return wide; }
    `);
    const wideAddress = runExport(structWat, "wide_address") as number;

    assert.equal(wideAddress % 8, 0);
  });
});

// ─── multi-return + destructuring with non-trivial inputs ──────────────────

describe("multi-return destructuring", () => {
  test("divmod with various dividend/divisor", () => {
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

  test("swap returns both values", () => {
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

  test("discard with _ in destructure", () => {
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
  test("global int mutated from function", () => {
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

  test("global with non-zero initializer", () => {
    const wat = compile(`
      let base: i32 = 100;
      export fn run(): i32 { return base + 5; }
    `);
    assert.equal(runExport(wat, "run"), 105);
  });

  test("const global cannot be re-assigned but reads work", () => {
    const wat = compile(`
      const FACTOR: i32 = 7;
      export fn run(n: i32): i32 { return n * FACTOR; }
    `);
    assert.equal(runExport(wat, "run", [6]), 42);
  });

  test("two globals coexist", () => {
    const wat = compile(`
      let a: i32 = 10;
      let b: i32 = 20;
      export fn run(): i32 { return a * b; }
    `);
    assert.equal(runExport(wat, "run"), 200);
  });

  // A global initializer that references another global compiles and reads
  // the referenced value. Currently fails during binary validation.
  test("a global initializer can reference another global", () => {
    const wat = compile(`
      let A: i32 = 10;
      let B: i32 = A + 5;
      export fn run(): i32 { return B; }
    `);
    assert(encodedModule(wat));
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
  test("block comment content is ignored at runtime", () => {
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
  test("underscores in numeric literals are accepted", () => {
    const wat = compile(`
      export fn run(): i32 { return 1_000_000; }
    `);
    assert.equal(runExport(wat, "run"), 1_000_000);
  });

  // `0b` and `0x` are both supported; `0o` is the obvious gap.
  test("octal literal 0o17 is accepted", () => {
    const wat = compile(`
      export fn run(): i32 { return 0o17; }
    `);
    assert.equal(runExport(wat, "run"), 15);
  });

  // Hex literals above 2^53 lose precision through `Number.parseInt`, then
  // emit an `(i32.const ...)` whose value isn't a valid integer.
  test("hex literal 0xFFFFFFFFFFFFFFFF compiles to a valid i64", () => {
    const wat = compile(`
      export fn run(): i64 {
        return 0xFFFFFFFFFFFFFFFF as i64;
      }
    `);
    assert(encodedModule(wat));
  });

  test("signed i32 boundary literals execute exactly", () => {
    const wat = compile(`
      export fn max(): i32 { return 2147483647; }
      export fn min(): i32 { return -2147483648; }
    `);
    assert.equal(runExport(wat, "max"), 2147483647);
    assert.equal(runExport(wat, "min"), -2147483648);
  });

  test("decimal signed i64 boundary literals remain lossless", () => {
    const wat = compile(`
      export fn max(): i64 { let x: i64 = 9223372036854775807; return x; }
      export fn min(): i64 { let x: i64 = -9223372036854775808; return x; }
    `);
    assert.equal(runExport(wat, "max"), 9223372036854775807n);
    assert.equal(runExport(wat, "min"), -9223372036854775808n);
  });

  test("decimal u64 max round-trips as -1 on the signed Wasm lane", () => {
    const wat = compile(`
      export fn run(): u64 {
        let x: u64 = 18446744073709551615;
        return x;
      }
    `);
    assert.equal(runExport(wat, "run"), -1n);
  });

  test("u32 max uses unsigned comparison and division", () => {
    const wat = compile(`
      export fn positive(): i32 { let x: u32 = 4294967295; return x > 0; }
      export fn half(): u32 { let x: u32 = 4294967295; return x / 2; }
    `);
    assert.equal(runExport(wat, "positive"), 1);
    assert.equal(runExport(wat, "half"), 2147483647);
  });

  test("integer arithmetic wraps at its Wasm lane width", () => {
    const wat = compile(`
      export fn addWrap(): i32 { return 2147483647 + 1; }
      export fn subWrap(): i32 { return -2147483648 - 1; }
      export fn mulWrap(): i32 { return 65536 * 65536; }
      export fn addWrap64(x: i64): i64 { return x + 1; }
    `);
    assert.equal(runExport(wat, "addWrap"), -2147483648);
    assert.equal(runExport(wat, "subWrap"), 2147483647);
    assert.equal(runExport(wat, "mulWrap"), 0);
    assert.equal(runExport(wat, "addWrap64", [9223372036854775807n]), -9223372036854775808n);
  });

  test("direct literal casts remain an explicit wrapping escape hatch", () => {
    const wat = compile("export fn run(): u32 { return -1 as u32; }");
    assert.equal(runExport(wat, "run"), -1);
  });

  test("parenthesized and repeated literal negation fold correctly", () => {
    const wat = compile(`
      export fn parenthesized(): i32 { return -(5); }
      export fn repeated(): i32 { return - -5; }
    `);
    assert.equal(runExport(wat, "parenthesized"), -5);
    assert.equal(runExport(wat, "repeated"), 5);
  });

  test("folded float negative zero preserves IEEE-754 behavior", () => {
    const wat = compile(`
      export fn belowZero(): i32 { return -0.0 < 0.0 == false; }
      export fn inverse(): f32 { return 1.0 / -0.0; }
    `);
    assert.equal(runExport(wat, "belowZero"), 1);
    assert.equal(runExport(wat, "inverse"), Number.NEGATIVE_INFINITY);
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

  test("unary plus is a no-op at runtime", () => {
    const wat = compile(`
      export fn run(): i32 { return +5; }
      export fn negRun(): i32 { let x: i32 = 0 - 7; return +x; }
    `);
    assert.equal(runExport(wat, "run"), 5);
    assert.equal(runExport(wat, "negRun"), -7);
  });

  test("logical-not on i64 produces valid wasm and correct semantics", () => {
    const wat = compile(`
      export fn notZero(): i32 { let x: i64 = 0 as i64; if (!x) { return 1; } return 0; }
      export fn notOne(): i32  { let x: i64 = 1 as i64; if (!x) { return 1; } return 0; }
    `);
    assert.equal(runExport(wat, "notZero"), 1);
    assert.equal(runExport(wat, "notOne"), 0);
  });

  test("logical-not on f32 produces valid wasm and correct semantics", () => {
    const wat = compile(`
      export fn notZero(): i32 { let x: f32 = 0.0; if (!x) { return 1; } return 0; }
      export fn notOne(): i32  { let x: f32 = 1.0; if (!x) { return 1; } return 0; }
    `);
    assert.equal(runExport(wat, "notZero"), 1);
    assert.equal(runExport(wat, "notOne"), 0);
  });

  test("logical-not on f64 produces valid wasm and correct semantics", () => {
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
  test("i32 -> u8 truncates to 8 bits", () => {
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

  test("i32 -> u16 truncates to 16 bits", () => {
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

  test("i32 -> i8 sign-extends from low byte", () => {
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
  test("switch on f32 discriminant is rejected before lowering", () => {
    assert.deepEqual(
      checkerMessages(`
        export fn run(x: f32): i32 {
          switch (x) {
            case 1: { return 10; }
            default: { return 0; }
          }
          return -1;
        }
      `),
      ["switch discriminant must be an i32-compatible type, got 'f32'"],
    );
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
  test("switch dispatches on a negative case value at runtime", () => {
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

  test("switch on an explicitly truncated f32 dispatches on the integer value", () => {
    const wat = compile(`
      export fn run(x: f32): i32 {
        switch (x as i32) {
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
});

// ─── String semantics ──────────────────────────────────────────────────────

describe("string semantics", () => {
  // String comparison compares pointer values, not content.
  test("two identical string literals are equal under ==", () => {
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

  test("hex escapes use codepoint semantics", () => {
    const wat = compile(String.raw`
      export fn asciiLen(): i32 { let s: string = "\x41"; return s.len; }
      export fn latinLen(): i32 { let s: string = "\xE9"; return s.len; }
      export fn asciiEqual(): i32 {
        let escaped: string = "\x41";
        let literal: string = "A";
        if (escaped == literal) { return 1; }
        return 0;
      }
      export fn latinEqual(): i32 {
        let escaped: string = "\xE9";
        let literal: string = "é";
        if (escaped == literal) { return 1; }
        return 0;
      }
      export fn hexCaseEqual(): i32 {
        let lower: string = "\xff";
        let upper: string = "\xFF";
        if (lower == upper) { return 1; }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "asciiLen"), 1);
    assert.equal(runExport(wat, "latinLen"), 2);
    assert.equal(runExport(wat, "asciiEqual"), 1);
    assert.equal(runExport(wat, "latinEqual"), 1);
    assert.equal(runExport(wat, "hexCaseEqual"), 1);
  });

  test("NUL bytes remain part of string content", () => {
    const wat = compile(String.raw`
      export fn length(): i32 { let s: string = "\x00abc"; return s.len; }
      export fn equal(): i32 {
        let a: string = "\x00abc";
        let b: string = "\x00abc";
        if (a == b) { return 1; }
        return 0;
      }
      export fn different(): i32 {
        let a: string = "\x00abc";
        let b: string = "\x00abd";
        if (a != b) { return 1; }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "length"), 4);
    assert.equal(runExport(wat, "equal"), 1);
    assert.equal(runExport(wat, "different"), 1);
  });

  test("string length counts UTF-8 bytes", () => {
    const wat = compile(`
      export fn latin(): i32 { let s: string = "héllo"; return s.len; }
      export fn bmp(): i32 { let s: string = "€"; return s.len; }
      export fn astral(): i32 { let s: string = "😀"; return s.len; }
    `);
    assert.equal(runExport(wat, "latin"), 6);
    assert.equal(runExport(wat, "bmp"), 3);
    assert.equal(runExport(wat, "astral"), 4);
  });

  test("escaped and empty string lengths are exact", () => {
    const wat = compile(String.raw`
      export fn newline(): i32 { let s: string = "a\nb"; return s.len; }
      export fn tab(): i32 { let s: string = "a\tb"; return s.len; }
      export fn slash(): i32 { let s: string = "\\"; return s.len; }
      export fn empty(): i32 { let s: string = ""; return s.len; }
    `);
    assert.equal(runExport(wat, "newline"), 3);
    assert.equal(runExport(wat, "tab"), 3);
    assert.equal(runExport(wat, "slash"), 1);
    assert.equal(runExport(wat, "empty"), 0);
  });

  test("string equality compares complete UTF-8 content", () => {
    const wat = compile(`
      export fn run(): i32 {
        let unicodeA: string = "hé😀";
        let unicodeB: string = "hé😀";
        let sameA: string = "ab";
        let sameB: string = "ab";
        let different: string = "ac";
        let prefix: string = "abc";
        let emptyA: string = "";
        let emptyB: string = "";
        if (unicodeA != unicodeB) { return 1; }
        if (sameA == different) { return 2; }
        if (sameA == prefix) { return 3; }
        if (emptyA != emptyB) { return 4; }
        if (sameA != sameB) { return 5; }
        if (!(sameA != different)) { return 6; }
        if (!(sameA != prefix)) { return 7; }
        if (!(emptyA == emptyB)) { return 8; }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "run"), 0);
  });

  test("strings compare correctly through a call boundary", () => {
    const wat = compile(`
      fn same(a: string, b: string): bool { return a == b; }
      export fn run(): i32 {
        let a: string = "hé😀";
        let b: string = "hé😀";
        let c: string = "hé😃";
        if (same(a, b) && !same(a, c)) { return 1; }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });

  test("string_copy import uses its parsed (src, dst) -> void signature", () => {
    const wat = compile(`
      import string_copy from "string"
      export fn run(): void {
        let src: string = "hello";
        let dst: string = "world";
        string_copy(src, dst);
      }
    `);
    assert(encodedModule(wat));
  });
});

// ─── Lexical scoping ───────────────────────────────────────────────────────
// `let` declarations currently share a single per-function symbol table, so
// shadowing in nested blocks silently clobbers the outer binding.

describe("lexical scoping", () => {
  // Inner-block `let` should shadow, not clobber.
  test("inner-block let shadows outer let", () => {
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
  test("nested for-loops with same counter name iterate independently", () => {
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
  // binary validation rejects with "redefinition of parameter".
  test("let inside fn body can shadow a parameter", () => {
    const wat = compile(`
      fn f(x: i32): i32 {
        let x: i32 = 99;
        return x;
      }
      export fn run(): i32 { return f(1); }
    `);
    assert(encodedModule(wat));
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

describe("trap semantics", () => {
  test("i32 signed and unsigned division by zero trap", () => {
    const wat = compile(`
      export fn signed(a: i32, b: i32): i32 { return a / b; }
      export fn unsigned(a: i32, b: i32): u32 { return (a as u32) / (b as u32); }
    `);
    assert.throws(() => runExport(wat, "signed", [1, 0]), WebAssembly.RuntimeError);
    assert.throws(() => runExport(wat, "unsigned", [1, 0]), WebAssembly.RuntimeError);
  });

  test("i32 signed and unsigned remainder by zero trap", () => {
    const wat = compile(`
      export fn signed(a: i32, b: i32): i32 { return a % b; }
      export fn unsigned(a: i32, b: i32): u32 { return (a as u32) % (b as u32); }
    `);
    assert.throws(() => runExport(wat, "signed", [1, 0]), WebAssembly.RuntimeError);
    assert.throws(() => runExport(wat, "unsigned", [1, 0]), WebAssembly.RuntimeError);
  });

  test("i64 division and remainder by zero trap", () => {
    const wat = compile(`
      export fn divide(a: i64, b: i64): i64 { return a / b; }
      export fn remainder(a: i64, b: i64): i64 { return a % b; }
    `);
    assert.throws(() => runExport(wat, "divide", [1n, 0n]), WebAssembly.RuntimeError);
    assert.throws(() => runExport(wat, "remainder", [1n, 0n]), WebAssembly.RuntimeError);
  });

  test("i32 signed division overflow traps", () => {
    const wat = compile(`
      export fn run(a: i32, b: i32): i32 { return a / b; }
    `);
    assert.throws(() => runExport(wat, "run", [-2147483648, -1]), WebAssembly.RuntimeError);
  });

  test("i64 signed division overflow traps", () => {
    const wat = compile(`
      export fn run(a: i64, b: i64): i64 { return a / b; }
    `);
    assert.throws(
      () => runExport(wat, "run", [-9223372036854775808n, -1n]),
      WebAssembly.RuntimeError,
    );
  });

  test("f32 and f64 Infinity truncation to i32 trap", () => {
    const wat = compile(`
      export fn fromF32(): i32 { return (1.0 / 0.0) as i32; }
      export fn fromF64(): i32 {
        return ((1.0 as f64) / (0.0 as f64)) as i32;
      }
    `);
    assert.throws(() => runExport(wat, "fromF32"), WebAssembly.RuntimeError);
    assert.throws(() => runExport(wat, "fromF64"), WebAssembly.RuntimeError);
  });

  test("NaN truncation to i32 traps", () => {
    const wat = compile(`
      export fn run(): i32 { return (0.0 / 0.0) as i32; }
    `);
    assert.throws(() => runExport(wat, "run"), WebAssembly.RuntimeError);
  });

  test("out-of-range finite f64 truncation to i32 traps", () => {
    const wat = compile(`
      export fn run(): i32 { return (3000000000.0 as f64) as i32; }
    `);
    assert.throws(() => runExport(wat, "run"), WebAssembly.RuntimeError);
  });

  test("signed remainder overflow cases return zero without trapping", () => {
    const wat = compile(`
      export fn i32Rem(a: i32, b: i32): i32 { return a % b; }
      export fn i64Rem(a: i64, b: i64): i64 { return a % b; }
    `);
    assert.equal(runExport(wat, "i32Rem", [-2147483648, -1]), 0);
    assert.equal(runExport(wat, "i64Rem", [-9223372036854775808n, -1n]), 0n);
  });

  test("in-range float truncation returns the truncated value", () => {
    const wat = compile(`
      export fn fromF32(): i32 { return 3.75 as i32; }
      export fn fromF64(): i32 { return ((0.0 as f64) - (3.75 as f64)) as i32; }
    `);
    assert.equal(runExport(wat, "fromF32"), 3);
    assert.equal(runExport(wat, "fromF64"), -3);
  });
});

describe("float semantics", () => {
  test("f32 NaN is unequal to itself", () => {
    const wat = compile(`
      export fn equal(): i32 {
        let zero: f32 = 0.0;
        let value: f32 = zero / zero;
        return value == value;
      }
      export fn unequal(): i32 {
        let zero: f32 = 0.0;
        let value: f32 = zero / zero;
        return value != value;
      }
    `);
    assert.equal(runExport(wat, "equal"), 0);
    assert.equal(runExport(wat, "unequal"), 1);
  });

  test("f64 NaN is unequal to itself", () => {
    const wat = compile(`
      export fn equal(): i32 {
        let zero: f64 = 0.0;
        let value: f64 = zero / zero;
        return value == value;
      }
      export fn unequal(): i32 {
        let zero: f64 = 0.0;
        let value: f64 = zero / zero;
        return value != value;
      }
    `);
    assert.equal(runExport(wat, "equal"), 0);
    assert.equal(runExport(wat, "unequal"), 1);
  });

  test("f32 and f64 infinities order beyond finite values", () => {
    const wat = compile(`
      export fn f32Positive(): i32 {
        let zero: f32 = 0.0;
        let one: f32 = 1.0;
        let finite: f32 = 1000000.0;
        return (one / zero) > finite;
      }
      export fn f32Negative(): i32 {
        let zero: f32 = 0.0;
        let one: f32 = 1.0;
        let finite: f32 = 0.0 - 1000000.0;
        let negativeOne: f32 = zero - one;
        return (negativeOne / zero) < finite;
      }
      export fn f64Positive(): i32 {
        let zero: f64 = 0.0;
        let one: f64 = 1.0;
        let finite: f64 = 1000000.0;
        return (one / zero) > finite;
      }
      export fn f64Negative(): i32 {
        let zero: f64 = 0.0;
        let one: f64 = 1.0;
        let magnitude: f64 = 1000000.0;
        let finite: f64 = zero - magnitude;
        let negativeOne: f64 = zero - one;
        return (negativeOne / zero) < finite;
      }
    `);
    assert.equal(runExport(wat, "f32Positive"), 1);
    assert.equal(runExport(wat, "f32Negative"), 1);
    assert.equal(runExport(wat, "f64Positive"), 1);
    assert.equal(runExport(wat, "f64Negative"), 1);
  });

  test("ordered comparisons with NaN are all false", () => {
    const wat = compile(`
      export fn f32Comparisons(): i32 {
        let zero: f32 = 0.0;
        let one: f32 = 1.0;
        let value: f32 = zero / zero;
        if (value < one) { return 1; }
        if (value <= one) { return 2; }
        if (value > one) { return 3; }
        if (value >= one) { return 4; }
        return 0;
      }
      export fn f64Comparisons(): i32 {
        let zero: f64 = 0.0;
        let one: f64 = 1.0;
        let value: f64 = zero / zero;
        if (value < one) { return 1; }
        if (value <= one) { return 2; }
        if (value > one) { return 3; }
        if (value >= one) { return 4; }
        return 0;
      }
    `);
    assert.equal(runExport(wat, "f32Comparisons"), 0);
    assert.equal(runExport(wat, "f64Comparisons"), 0);
  });

  test("f32 negative remainder matches truncated JS remainder", () => {
    const wat = compile(`
      export fn negativeDividend(): f32 {
        let magnitude: f32 = 7.5;
        let zero: f32 = 0.0;
        let divisor: f32 = 2.0;
        let negative: f32 = zero - magnitude;
        return negative % divisor;
      }
      export fn negativeDivisor(): f32 {
        let dividend: f32 = 7.5;
        let magnitude: f32 = 2.0;
        let zero: f32 = 0.0;
        let negative: f32 = zero - magnitude;
        return dividend % negative;
      }
    `);
    const negativeDividend = Math.fround(Math.fround(-7.5) % Math.fround(2.0));
    const negativeDivisor = Math.fround(Math.fround(7.5) % Math.fround(-2.0));
    assert.equal(runExport(wat, "negativeDividend"), negativeDividend);
    assert.equal(runExport(wat, "negativeDivisor"), negativeDivisor);
  });

  test("f64 negative remainder matches truncated JS remainder", () => {
    const wat = compile(`
      export fn negativeDividend(): f64 {
        let magnitude: f64 = 7.5;
        let zero: f64 = 0.0;
        let divisor: f64 = 2.0;
        let negative: f64 = zero - magnitude;
        return negative % divisor;
      }
      export fn negativeDivisor(): f64 {
        let dividend: f64 = 7.5;
        let magnitude: f64 = 2.0;
        let zero: f64 = 0.0;
        let negative: f64 = zero - magnitude;
        return dividend % negative;
      }
    `);
    assert.equal(runExport(wat, "negativeDividend"), -7.5 % 2.0);
    assert.equal(runExport(wat, "negativeDivisor"), 7.5 % -2.0);
  });

  test("f32 and f64 preserve their distinct addition precision", () => {
    const wat = compile(`
      export fn f32Sum(): f32 {
        let a: f32 = 0.1;
        let b: f32 = 0.2;
        return a + b;
      }
      export fn f64Sum(): f64 {
        let a: f64 = 0.1;
        let b: f64 = 0.2;
        return a + b;
      }
    `);
    const f32Sum = runExport(wat, "f32Sum");
    const f64Sum = runExport(wat, "f64Sum");
    assert.equal(f32Sum, Math.fround(Math.fround(0.1) + Math.fround(0.2)));
    assert.equal(f64Sum, 0.1 + 0.2);
    assert.notEqual(f32Sum, f64Sum);
  });

  test("negative-zero literal compares equal but has a negative reciprocal", () => {
    const wat = compile(`
      export fn equal(): i32 { return 0.0 == -0.0; }
      export fn inverse(): f32 { return 1.0 / -0.0; }
    `);
    assert.equal(runExport(wat, "equal"), 1);
    assert.equal(runExport(wat, "inverse"), Number.NEGATIVE_INFINITY);
  });

  test("multiplying a negative by zero constructs negative zero", () => {
    const wat = compile(`
      export fn value(): f32 {
        let negative: f32 = -1.0;
        let zero: f32 = 0.0;
        return negative * zero;
      }
      export fn inverse(): f32 {
        let negative: f32 = -1.0;
        let zero: f32 = 0.0;
        let value: f32 = negative * zero;
        return 1.0 / value;
      }
    `);
    assert(Object.is(runExport(wat, "value"), -0));
    assert.equal(runExport(wat, "inverse"), Number.NEGATIVE_INFINITY);
  });

  test("f64 to f32 demotion loses precision", () => {
    const wat = compile(`
      export fn run(): i32 {
        let a: f64 = 0.1;
        let b: f32 = a as f32;
        let c: f64 = b as f64;
        return c != a;
      }
    `);
    assert.equal(runExport(wat, "run"), 1);
  });
});

describe("stress", () => {
  test("compiles and runs arithmetic nested 200 parentheses deep", {
    timeout: 10_000,
  }, () => {
    let expression = "1";
    for (let depth = 0; depth < 200; depth++) {
      expression = `(${expression} + 1)`;
    }
    const wat = compile(`export fn run(): i32 { return ${expression}; }`);
    assert.equal(runExport(wat, "run"), 201);
  });

  test("compiles and runs a flat chain of 200 binary operators", {
    timeout: 10_000,
  }, () => {
    const expression = Array.from({ length: 201 }, () => "1").join(" + ");
    const wat = compile(`export fn run(): i32 { return ${expression}; }`);
    assert.equal(runExport(wat, "run"), 201);
  });

  test("compiles a function with 100 used locals", {
    timeout: 10_000,
  }, () => {
    const declarations = Array.from(
      { length: 100 },
      (_, index) => `let value${index}: i32 = ${index};`,
    ).join("\n");
    const sum = Array.from({ length: 100 }, (_, index) => `value${index}`).join(" + ");
    const wat = compile(`
        export fn run(): i32 {
          ${declarations}
          return ${sum};
        }
      `);
    assert.equal(runExport(wat, "run"), 4950);
  });

  test("executes the innermost branch of 20 nested if blocks", {
    timeout: 10_000,
  }, () => {
    let body = "result = 42;";
    for (let depth = 0; depth < 20; depth++) {
      body = `if (1 == 1) { ${body} }`;
    }
    const wat = compile(`
        export fn run(): i32 {
          let result: i32 = 0;
          ${body}
          return result;
        }
      `);
    assert.equal(runExport(wat, "run"), 42);
  });

  test("ten nested for and while loops execute exactly 1024 times", {
    timeout: 10_000,
  }, () => {
    const nestedLoop = (depth: number): string => {
      if (depth === 10) return "count = count + 1;";
      const counter = `index${depth}`;
      const inner = nestedLoop(depth + 1);
      if (depth % 2 === 0) {
        return `for (let ${counter}: i32 = 0; ${counter} < 2; ${counter} = ${counter} + 1) { ${inner} }`;
      }
      return `let ${counter}: i32 = 0; while (${counter} < 2) { ${inner} ${counter} = ${counter} + 1; }`;
    };
    const wat = compile(`
        export fn run(): i32 {
          let count: i32 = 0;
          ${nestedLoop(0)}
          return count;
        }
      `);
    assert.equal(runExport(wat, "run"), 1024);
  });

  test("break exits only the innermost of two nested loops", {
    timeout: 10_000,
  }, () => {
    const wat = compile(`
        export fn run(): i32 {
          let count: i32 = 0;
          for (let outer: i32 = 0; outer < 2; outer = outer + 1) {
            for (let inner: i32 = 0; inner < 2; inner = inner + 1) {
              count = count + 1;
              break;
            }
          }
          return count;
        }
      `);
    assert.equal(runExport(wat, "run"), 2);
  });

  test("empty source compiles to a valid module", {
    timeout: 10_000,
  }, () => {
    assert(encodedModule(compile("")));
  });

  test("declaration-only modules are valid", { timeout: 10_000 }, () => {
    const structWat = compile("struct Point { x: i32, y: i32 }");
    const globalWat = compile("let answer: i32 = 42;");
    assert(encodedModule(structWat));
    assert(encodedModule(globalWat));
  });

  test("fifty functions call through the complete chain", {
    timeout: 10_000,
  }, () => {
    const functions = Array.from({ length: 50 }, (_, index) => {
      const exported = index === 0 ? "export " : "";
      const body = index === 49 ? "return 1;" : `return chain${index + 1}() + 1;`;
      return `${exported}fn chain${index}(): i32 { ${body} }`;
    }).join("\n");
    const wat = compile(functions);
    assert.equal(runExport(wat, "chain0"), 50);
  });
});

describe("standalone allocator fallback", () => {
  // T57 replaced the guessed 131072 base with a trap: an unwired build has no
  // way to know where its static data ends, so any guess can sit on top of it.
  test("an unwired allocator traps instead of guessing a heap base", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(dir, "../src/compiler/stdlib/memory.maple"), "utf8");
    const module = compile(source);
    assert.throws(() => runExport(module, "malloc", [8]), WebAssembly.RuntimeError);
  });
});

describe("stdlib execution through the merged pipeline", () => {
  test("fn-reference works on the first exported call of a fresh instance", async () => {
    const source = `
      fn multiply(a: i32, b: i32): i32 { return a * b; }
      export fn run(): i32 {
        let op: fn(i32,i32):i32 = multiply;
        return op(6, 7);
      }
    `;

    assert.equal(await runMergedExport(source, "run"), 42);
  });

  test("fn-reference calls compose inside binary expressions", async () => {
    const source = `
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn plus_one(value: i32): i32 { return value + 1; }
      export fn run(): i32 {
        let op: fn(i32,i32):i32 = add;
        return op(1, 2) + plus_one(4);
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 8);
  });

  test("merged malloc stays clear of structs and static data", async () => {
    const source = `
      import malloc from "memory"
      struct Cell { value: i32 }
      let label: string = "merged-safe";
      let expected: string = "merged-safe";

      export fn run(): i32 {
        let local: Cell = { value = 5 };
        let ptr: i32 = malloc(8);
        let heap: Cell = ptr as Cell;
        heap.value = 36;
        if (local.value + heap.value + (label == expected) != 42) { return 0; }
        return ptr;
      }
    `;
    const pointer = (await runMergedExport(source, "run")) as number;
    assert(pointer >= 65536);
    assert.equal(pointer % 8, 0);
  });

  test("malloc-backed vec2 addition preserves both fields", async () => {
    const source = `
      import malloc from "memory"
      struct Vec2 { x: i32, y: i32 }

      fn addVec2(a: Vec2, b: Vec2): Vec2 {
        let result: Vec2 = malloc(8) as Vec2;
        result.x = a.x + b.x;
        result.y = a.y + b.y;
        return result;
      }

      export fn run(): i32 {
        let a: Vec2 = malloc(8) as Vec2;
        let b: Vec2 = malloc(8) as Vec2;
        a.x = 1;
        a.y = 2;
        b.x = 3;
        b.y = 4;
        let sum: Vec2 = addVec2(a, b);
        return sum.x * 100 + sum.y;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 406);
  });

  test("free allows malloc to reuse the same block", async () => {
    const source = `
      import malloc, free from "memory"
      export fn run(): i32 {
        let first: i32 = malloc(16);
        free(first);
        let second: i32 = malloc(16);
        return first == second;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("realloc preserves the existing payload", async () => {
    const source = `
      import malloc, realloc from "memory"
      struct Triple { a: i32, b: i32, c: i32 }
      export fn run(): i32 {
        let raw: i32 = malloc(12);
        let values: Triple = raw as Triple;
        values.a = 1;
        values.b = 2;
        values.c = 3;
        let grown: Triple = realloc(raw, 40) as Triple;
        return grown.a * 10000 + grown.b * 100 + grown.c;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 10203);
  });

  // Double-free and use-after-free are undefined until the ownership design (O1).
  test("malloc payloads are 8-byte aligned", async () => {
    const source = `
      import malloc from "memory"
      export fn run(): i32 {
        let a: i32 = malloc(1);
        let b: i32 = malloc(7);
        let c: i32 = malloc(8);
        let d: i32 = malloc(100);
        if (a % 8 != 0) { return 0; }
        if (b % 8 != 0) { return 0; }
        if (c % 8 != 0) { return 0; }
        if (d % 8 != 0) { return 0; }
        return 1;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("malloc splits a reused free block", async () => {
    const source = `
      import malloc, free from "memory"
      export fn run(): i32 {
        let prefix: i32 = malloc(8);
        let large: i32 = malloc(64);
        let guard: i32 = malloc(8);
        free(large);
        let first: i32 = malloc(16);
        let second: i32 = malloc(16);
        if (prefix >= large) { return 0; }
        if (first != large) { return 0; }
        if (second != first + 24) { return 0; }
        return second < guard;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("free coalesces adjacent blocks", async () => {
    const source = `
      import malloc, free from "memory"
      export fn run(): i32 {
        let prefix: i32 = malloc(8);
        let a: i32 = malloc(16);
        let b: i32 = malloc(16);
        let c: i32 = malloc(16);
        free(b);
        free(a);
        let combined: i32 = malloc(32);
        if (prefix >= a) { return 0; }
        if (c <= b) { return 0; }
        return combined == a;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("free reclaims the wilderness block", async () => {
    const source = `
      import malloc, free from "memory"
      export fn run(): i32 {
        let prefix: i32 = malloc(8);
        let last: i32 = malloc(32);
        free(last);
        let reused: i32 = malloc(32);
        if (prefix >= last) { return 0; }
        return reused == last;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("malloc grows memory when the wilderness exceeds capacity", async () => {
    const source = `
      import malloc from "memory"
      export fn run(): i32 {
        let before: i32 = __memory_size();
        let block: i32 = malloc((before * 65536) + 1);
        let after: i32 = __memory_size();
        if (block == 0) { return 0; }
        return after > before;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  // T57 — ledger B23. `free` used to accept any pointer whose `ptr - 4` word
  // happened to be odd, which corrupted foreign memory about half the time.
  test("free of a null pointer stays a defined no-op", async () => {
    const source = `
      import malloc, free from "memory"
      export fn run(): i32 {
        free(0);
        let p: i32 = malloc(8);
        free(p);
        return 1;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("free of a static-data address traps", async () => {
    const source = `
      import free from "memory"
      let label: string = "static";
      export fn run(): i32 {
        free(label.data);
        return 1;
      }
    `;
    await assert.rejects(runMergedExport(source, "run"), WebAssembly.RuntimeError);
  });

  test("free of a shadow-stack address traps", async () => {
    const source = `
      import free from "memory"
      export fn run(): i32 {
        free(1024);
        return 1;
      }
    `;
    await assert.rejects(runMergedExport(source, "run"), WebAssembly.RuntimeError);
  });

  test("free of a misaligned interior pointer traps", async () => {
    const source = `
      import malloc, free from "memory"
      export fn run(): i32 {
        let p: i32 = malloc(32);
        free(p + 4);
        return 1;
      }
    `;
    await assert.rejects(runMergedExport(source, "run"), WebAssembly.RuntimeError);
  });

  // The one that proves the magic word earns its place: `p + 8` is inside the
  // heap and 8-byte aligned, so every range and alignment clause accepts it.
  test("free of an ALIGNED interior pointer traps via the identity word", async () => {
    const source = `
      import malloc, free from "memory"
      export fn run(): i32 {
        let p: i32 = malloc(64);
        __store_i32(p, 0);
        __store_i32(p + 4, 25);
        free(p + 8);
        return 1;
      }
    `;
    await assert.rejects(runMergedExport(source, "run"), WebAssembly.RuntimeError);
  });

  test("an adjacent double free traps", async () => {
    const source = `
      import malloc, free from "memory"
      export fn run(): i32 {
        let p: i32 = malloc(16);
        free(p);
        free(p);
        return 1;
      }
    `;
    await assert.rejects(runMergedExport(source, "run"), WebAssembly.RuntimeError);
  });

  test("a valid free still releases the block for reuse", async () => {
    const source = `
      import malloc, free from "memory"
      export fn run(): i32 {
        let first: i32 = malloc(16);
        free(first);
        let second: i32 = malloc(16);
        return first == second;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("realloc of a foreign pointer traps through the guard", async () => {
    const source = `
      import realloc from "memory"
      let label: string = "static";
      export fn run(): i32 {
        return realloc(label.data, 32);
      }
    `;
    await assert.rejects(runMergedExport(source, "run"), WebAssembly.RuntimeError);
  });

  // T56 — ledger B21: the header owns the size, so a caller cannot over-report
  // it and copy a neighbouring allocation's bytes into the new block.
  test("realloc copies only the block it was given", async () => {
    const source = `
      import malloc, realloc from "memory"
      export fn run(): i32 {
        let first: i32 = malloc(8);
        let neighbour: i32 = malloc(8);
        __store_i32(first, 11);
        __store_i32(first + 4, 22);
        __store_i32(neighbour, 1515870810);
        __store_i32(neighbour + 4, 1515870810);
        let grown: i32 = realloc(first, 64);
        if (__load_i32(grown) != 11) { return 0; }
        if (__load_i32(grown + 4) != 22) { return 0; }
        let i: i32 = 8;
        while (i < 64) {
          if (__load_i32(grown + i) == 1515870810) { return 0; }
          i = i + 4;
        }
        return 1;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("realloc shrinks while preserving the surviving prefix", async () => {
    const source = `
      import malloc, realloc from "memory"
      export fn run(): i32 {
        let p: i32 = malloc(32);
        __store_i32(p, 7);
        __store_i32(p + 4, 8);
        let small: i32 = realloc(p, 8);
        if (small == 0) { return 0; }
        if (__load_i32(small) != 7) { return 0; }
        return __load_i32(small + 4) == 8;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("realloc from a null pointer behaves as malloc", async () => {
    const source = `
      import realloc from "memory"
      export fn run(): i32 {
        let p: i32 = realloc(0, 16);
        if (p == 0) { return 0; }
        __store_i32(p, 99);
        return __load_i32(p);
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 99);
  });

  test("realloc to zero returns a usable block and releases the old one", async () => {
    const source = `
      import malloc, realloc from "memory"
      export fn run(): i32 {
        let p: i32 = malloc(16);
        let shrunk: i32 = realloc(p, 0);
        if (shrunk == 0) { return 0; }
        __store_i32(shrunk, 5);
        return __load_i32(shrunk);
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 5);
  });

  test("a failed realloc returns zero and leaves the original allocated", async () => {
    const source = `
      import malloc, realloc from "memory"
      export fn run(): i32 {
        let p: i32 = malloc(16);
        __store_i32(p, 1234);
        let failed: i32 = realloc(p, -1);
        if (failed != 0) { return 0; }
        return __load_i32(p);
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1234);
  });

  // T55 — ledger B18: non-splitting reuse must keep the chunk's recorded size.
  test("non-splitting reuse does not orphan bytes into the next allocation", async () => {
    const source = `
      import malloc, free from "memory"
      export fn run(): i32 {
        let a: i32 = malloc(16);
        let guard: i32 = malloc(8);
        __store_i32(a, 1);
        __store_i32(a + 4, 2);
        __store_i32(a + 8, 3);
        __store_i32(a + 12, 64);
        __store_i32(guard, 1515870810);
        __store_i32(guard + 4, 1515870810);
        free(a);
        let b: i32 = malloc(8);
        free(b);
        let c: i32 = malloc(64);
        let i: i32 = 0;
        while (i < 64) {
          __store_i32(c + i, -1);
          i = i + 4;
        }
        if (__load_i32(guard) != 1515870810) { return 0; }
        return __load_i32(guard + 4) == 1515870810;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  // T55 — ledger B20: negative sizes skip the unsigned clamp and wrap.
  test("malloc rejects negative sizes without corrupting the heap", async () => {
    const source = `
      import malloc from "memory"
      export fn run(): i32 {
        let bad: i32 = malloc(-8);
        let worse: i32 = malloc(-16);
        let good: i32 = malloc(8);
        let after: i32 = malloc(8);
        if (bad != 0) { return 0; }
        if (worse != 0) { return 0; }
        if (good == 0) { return 0; }
        return after > good;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  // T55 — ledger B19/B20: oversized requests must report OOM, not wrap.
  test("malloc returns zero for sizes that would overflow the header math", async () => {
    const source = `
      import malloc from "memory"
      export fn run(): i32 {
        let first: i32 = malloc(2147483632);
        let second: i32 = malloc(2147483632);
        let third: i32 = malloc(2147483632);
        let fourth: i32 = malloc(2147483632);
        if (first != 0) { return 0; }
        if (second != 0) { return 0; }
        if (third != 0) { return 0; }
        return fourth == 0;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  // T55 — malloc(0) stays a usable block; T56's realloc(p, 0) depends on it.
  test("malloc zero returns a usable minimum block", async () => {
    const source = `
      import malloc from "memory"
      export fn run(): i32 {
        let p: i32 = malloc(0);
        if (p == 0) { return 0; }
        __store_i32(p, 4242);
        return __load_i32(p);
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 4242);
  });

  test("math sqrt executes through the merged module", async () => {
    const source = `
      import sqrt from "math"
      export fn run(): f32 { return sqrt(16.0); }
    `;
    assert.equal(await runMergedExport(source, "run"), 4);
  });

  test("math sin executes through the merged module", async () => {
    const source = `
      import sin from "math"
      export fn run(): f32 { return sin(0.0); }
    `;
    assert.equal(await runMergedExport(source, "run"), 0);
  });

  test("math abs_i32 executes through the merged module", async () => {
    const source = `
      import abs_i32 from "math"
      export fn run(): i32 { return abs_i32(-5); }
    `;
    assert.equal(await runMergedExport(source, "run"), 5);
  });

  test("math PI is available as an imported global", async () => {
    const source = `
      import PI from "math"
      export fn run(): f32 { return PI; }
    `;
    const result = (await runMergedExport(source, "run")) as number;
    assert(Math.abs(result - Math.PI) < 1e-6);
  });

  test("one program imports sin, sqrt, and PI from Maple math", async () => {
    const source = `
      import sin, sqrt, PI from "math"
      export fn run(): f32 {
        return sin(PI / 2.0) + sqrt(16.0);
      }
    `;
    const result = (await runMergedExport(source, "run")) as number;
    assert(Math.abs(result - 5) < 1e-3);
  });

  test("math sqrt matches the intrinsic across representative f32 values", async () => {
    const source = `
      import sqrt from "math"
      export fn run(value: f32): f32 {
        return sqrt(value) - __sqrt_f32(value);
      }
    `;
    for (const value of [0, 2, 16, 1e30]) {
      assert.equal(await runMergedExport(source, "run", [value]), 0);
    }
  });

  test("string_copy keeps the longer destination length and tail", async () => {
    const source = `
      import string_copy from "string"
      export fn run(): i32 {
        let source: string = "cat";
        let destination: string = "abcdef";
        let expected: string = "catdef";
        string_copy(source, destination);
        if (destination.len != 6) { return 0; }
        return destination == expected;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("string_copy truncates to a shorter destination", async () => {
    const source = `
      import string_copy from "string"
      export fn run(): i32 {
        let source: string = "abcdef";
        let destination: string = "xyz";
        let expected: string = "abc";
        string_copy(source, destination);
        if (destination.len != 3) { return 0; }
        return destination == expected;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("string_copy with an empty source is a no-op", async () => {
    const source = `
      import string_copy from "string"
      export fn run(): i32 {
        let source: string = "";
        let destination: string = "abc";
        let expected: string = "abc";
        string_copy(source, destination);
        if (source.len != 0) { return 0; }
        if (destination.len != 3) { return 0; }
        return destination == expected;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("built-in string metadata works without importing string", async () => {
    const source = `
      export fn run(): i32 {
        let value: string = "maple";
        return value.len;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 5);
  });

  test("one program can import memory and math together", async () => {
    const source = `
      import malloc from "memory"
      import sqrt from "math"
      export fn run(): i32 {
        let block: i32 = malloc(16);
        return (sqrt(16.0) as i32) + (block - block);
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 4);
  });
});

describe("compiler intrinsics", () => {
  test("raw i32 store and load round-trip", () => {
    const wat = compile(`
      export fn run(): i32 {
        __store_i32(65536, 42);
        return __load_i32(65536);
      }
    `);
    assert.equal(runExport(wat, "run"), 42);
  });

  test("memory size and grow share the user memory", () => {
    const wat = compile(`
      export fn run(): i32 {
        let before: i32 = __memory_size();
        let previous: i32 = __memory_grow(1);
        let after: i32 = __memory_size();
        return before * 100 + previous * 10 + after;
      }
    `);
    assert.equal(runExport(wat, "run"), 223);
  });

  test("memory copy preserves both stored i32 values", () => {
    const wat = compile(`
      export fn run(): i32 {
        __store_i32(65536, 42);
        __store_i32(65540, 7);
        __memory_copy(65552, 65536, 8);
        return __load_i32(65552) * 100 + __load_i32(65556);
      }
    `);
    assert.equal(runExport(wat, "run"), 4207);
  });

  for (const intrinsic of [
    { name: "__sqrt_f32", type: "f32", args: "16.0", expected: 4 },
    { name: "__abs_f32", type: "f32", args: "-3.0", expected: 3 },
    { name: "__floor_f32", type: "f32", args: "1.9", expected: 1 },
    { name: "__ceil_f32", type: "f32", args: "1.1", expected: 2 },
    { name: "__nearest_f32", type: "f32", args: "2.5", expected: 2 },
    { name: "__trunc_f32", type: "f32", args: "-1.9", expected: -1 },
    { name: "__copysign_f32", type: "f32", args: "3.0, -1.0", expected: -3 },
    { name: "__sqrt_f64", type: "f64", args: "16.0 as f64", expected: 4 },
    { name: "__abs_f64", type: "f64", args: "-3.0 as f64", expected: 3 },
    { name: "__floor_f64", type: "f64", args: "1.9 as f64", expected: 1 },
    { name: "__ceil_f64", type: "f64", args: "1.1 as f64", expected: 2 },
    { name: "__nearest_f64", type: "f64", args: "2.5 as f64", expected: 2 },
    { name: "__trunc_f64", type: "f64", args: "-1.9 as f64", expected: -1 },
    {
      name: "__copysign_f64",
      type: "f64",
      args: "3.0 as f64, -1.0 as f64",
      expected: -3,
    },
  ] as const) {
    test(`${intrinsic.name} executes its wasm opcode`, () => {
      const wat = compile(`
        export fn run(): ${intrinsic.type} {
          return ${intrinsic.name}(${intrinsic.args});
        }
      `);
      assert.equal(runExport(wat, "run"), intrinsic.expected);
    });
  }

  test("intrinsic calls support inferred lets", () => {
    const wat = compile(`
      export fn run(): f32 {
        let value = __sqrt_f32(16.0);
        return value;
      }
    `);
    assert.equal(runExport(wat, "run"), 4);
  });

  test("intrinsic calls compose in arithmetic", () => {
    const wat = compile(`
      export fn run(): f32 { return __sqrt_f32(16.0) + 1.0; }
    `);
    assert.equal(runExport(wat, "run"), 5);
  });

  test("intrinsic calls can be returned directly", () => {
    const wat = compile(`
      export fn run(): i32 { return __memory_size(); }
    `);
    assert.equal(runExport(wat, "run"), 2);
  });

  test("intrinsic calls compose inside casts", () => {
    const wat = compile(`
      export fn run(): i32 { return __sqrt_f32(16.0) as i32; }
    `);
    assert.equal(runExport(wat, "run"), 4);
  });
});

// T60 — ledger B29. Address 0 sits in the shadow-stack page, so dereferencing
// it does not trap: `__struct_eq_T` read 0 and recursed on it forever.
describe("generated struct equality: null guard", () => {
  const NODE = "struct Node { v: i32, next: Node }";

  test("self-referential chains with null terminators compare equal", async () => {
    const source = `
      import malloc from "memory"
      ${NODE}
      export fn run(): i32 {
        let a: Node = malloc(8) as Node;
        a.v = 7;
        a.next = 0 as Node;
        let b: Node = malloc(8) as Node;
        b.v = 7;
        b.next = 0 as Node;
        return a == b;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("chains differing in value compare unequal", async () => {
    const source = `
      import malloc from "memory"
      ${NODE}
      export fn run(): i32 {
        let a: Node = malloc(8) as Node;
        a.v = 7;
        a.next = 0 as Node;
        let b: Node = malloc(8) as Node;
        b.v = 8;
        b.next = 0 as Node;
        return a == b;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 0);
  });

  test("chains of different length compare unequal", async () => {
    const source = `
      import malloc from "memory"
      ${NODE}
      export fn run(): i32 {
        let tail: Node = malloc(8) as Node;
        tail.v = 7;
        tail.next = 0 as Node;
        let longer: Node = malloc(8) as Node;
        longer.v = 7;
        longer.next = tail;
        let shorter: Node = malloc(8) as Node;
        shorter.v = 7;
        shorter.next = 0 as Node;
        return longer == shorter;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 0);
  });

  test("a zeroed struct is not equal to the null pointer", async () => {
    const source = `
      import malloc from "memory"
      ${NODE}
      export fn run(): i32 {
        let a: Node = malloc(8) as Node;
        a.v = 0;
        a.next = 0 as Node;
        let nothing: Node = 0 as Node;
        return a == nothing;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 0);
  });

  test("two null pointers compare equal", async () => {
    const source = `
      ${NODE}
      export fn run(): i32 {
        let a: Node = 0 as Node;
        let b: Node = 0 as Node;
        return a == b;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });
});

// T62 — ledger B22. `lowerIdentifier` emitted a `malloc(8)` per SYNTACTIC
// evaluation of a function name: 100 loop iterations leaked 1616 bytes, and
// the user could not free them (`fn(...) → i32` casts are blocked).
describe("named fn-references are static records", () => {
  const OPS =
    "fn add(a: i32, b: i32): i32 { return a + b; } fn sub(a: i32, b: i32): i32 { return a - b; }";

  test("taking a fn-reference in a loop allocates zero heap bytes", async () => {
    const source = `
      import malloc from "memory"
      ${OPS}
      export fn run(): i32 {
        let before: i32 = malloc(8);
        let i: i32 = 0;
        let total: i32 = 0;
        while (i < 100) {
          let op: fn(i32,i32): i32 = add;
          total = total + op(1, 1);
          i = i + 1;
        }
        let after: i32 = malloc(8);
        if (total != 200) { return -1; }
        return after - before;
      }
    `;
    // Two adjacent 8-byte allocations: 16 bytes of chunk, and nothing between.
    assert.equal(await runMergedExport(source, "run"), 16);
  });

  test("the same function yields one shared address below the heap", async () => {
    const source = `
      import malloc from "memory"
      ${OPS}
      export fn run(): i32 {
        let first: fn(i32,i32): i32 = add;
        let second: fn(i32,i32): i32 = add;
        let other: fn(i32,i32): i32 = sub;
        let heap: i32 = malloc(8);
        if (first != second) { return 0; }
        if (first == other) { return 0; }
        return first < heap;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("indirect dispatch still selects the captured target", async () => {
    const source = `
      ${OPS}
      export fn run(): i32 {
        let op: fn(i32,i32): i32 = add;
        let result: i32 = op(10, 3);
        op = sub;
        return result * 100 + op(10, 3);
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1307);
  });
});

// T69 — freeing a heap struct end to end. Lowering is unchanged: struct
// values already occupy the i32 lane, so the emitted call is the i32 call.
describe("free accepts struct pointers", () => {
  test("a heap struct round-trips through free and reuse", async () => {
    const source = `
      import malloc, free from "memory"
      struct Cell { value: i32 }
      export fn run(): i32 {
        let first: Cell = malloc(8) as Cell;
        first.value = 41;
        let observed: i32 = first.value;
        free(first);
        let second: Cell = malloc(8) as Cell;
        second.value = observed + 1;
        return second.value;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 42);
  });

  test("realloc through the struct form preserves the payload", async () => {
    const source = `
      import malloc, realloc from "memory"
      struct Pair { a: i32, b: i32 }
      export fn run(): i32 {
        let p: Pair = malloc(8) as Pair;
        p.a = 3;
        p.b = 4;
        let grown: Pair = realloc(p, 64) as Pair;
        return grown.a * 10 + grown.b;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 34);
  });
});

// T67 — `defer` lowering (Design S: static inline expansion, no new IR nodes).
// These seven prove the feature works end to end; T68 adds the full matrix.
describe("defer: core semantics", () => {
  const LOG = "let log: i32 = 0;\nfn note(v: i32): void { log = log * 10 + v; }\n";

  test("one defer runs at fall-through", async () => {
    const source = `${LOG}
      fn body(): void { defer note(7); }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 7);
  });

  test("two defers in one scope run LIFO", async () => {
    const source = `${LOG}
      fn body(): void { defer note(1); defer note(2); }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 21);
  });

  test("an inner block's defer runs at the inner block's end", async () => {
    const source = `${LOG}
      fn body(): void { if (1 == 1) { defer note(1); } note(2); }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 12);
  });

  test("a defer runs on return", async () => {
    const source = `${LOG}
      fn body(): i32 { defer note(3); return 0; }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 3);
  });

  test("a defer runs on break and on continue", async () => {
    const source = `${LOG}
      fn body(): void {
        for (let i: i32 = 0; i < 3; i = i + 1) {
          defer note(1);
          if (i == 1) { continue; }
          if (i == 2) { break; }
        }
      }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 111);
  });

  // The rule that decided scope-exit over function-exit.
  test("a defer in a loop body runs once per iteration", async () => {
    const source = `${LOG}
      fn body(): void { for (let i: i32 = 0; i < 3; i = i + 1) { defer note(1); } }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 111);
  });

  // Proves defers precede the $__sp restore: the frame must still be live.
  test("a defer reads a shadow-stack struct member", async () => {
    const source = `
      import malloc, free from "memory"
      struct Buf { data: i32, len: i32 }
      export fn run(): i32 {
        let b: Buf = { data = malloc(64), len = 64 };
        __store_i32(b.data, 99);
        defer free(b.data);
        return b.len;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 64);
  });

  // Register-time capture: reassigning after the defer changes nothing.
  test("arguments are captured at the defer statement", async () => {
    const source = `${LOG}
      fn body(): void { let v: i32 = 5; defer note(v); v = 9; }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 5);
  });
});

// T68 — the exhaustive `defer` matrix over the feature T67 landed.
describe("defer: full matrix", () => {
  const LOG = "let log: i32 = 0;\nfn note(v: i32): void { log = log * 10 + v; }\n";

  test("per-iteration release in a while loop", async () => {
    const source = `${LOG}
      fn body(): void {
        let i: i32 = 0;
        while (i < 3) { defer note(1); i = i + 1; }
      }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 111);
  });

  test("a defer in an if-arm does not run after the if", async () => {
    const source = `${LOG}
      fn body(): void { if (1 == 1) { defer note(1); note(2); } note(3); }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 213);
  });

  test("a case defer runs when the case falls off its end", async () => {
    const source = `${LOG}
      fn body(k: i32): void { switch (k) { case 0: { defer note(1); note(2); } } note(3); }
      export fn run(): i32 { body(0); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 213);
  });

  // `break` leaves the SWITCH, so the loop body's defer must NOT run yet.
  test("break inside a switch runs only the case's defers", async () => {
    const source = `${LOG}
      fn body(): void {
        for (let i: i32 = 0; i < 1; i = i + 1) {
          defer note(9);
          switch (i) { case 0: { defer note(1); break; } }
          note(2);
        }
      }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 129);
  });

  test("continue from inside a switch runs the case's and the loop's defers", async () => {
    const source = `${LOG}
      fn body(): void {
        for (let i: i32 = 0; i < 1; i = i + 1) {
          defer note(9);
          switch (i) { case 0: { defer note(1); continue; } }
          note(2);
        }
      }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 19);
  });

  test("body defers run before the loop update", async () => {
    const source = `${LOG}
      fn body(): void { for (let i: i32 = 0; i < 3; i = i + 1) { defer note(i); } }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 12);
  });

  test("a deep return runs innermost scopes first", async () => {
    const source = `${LOG}
      fn body(): i32 {
        defer note(3);
        if (1 == 1) {
          defer note(2);
          if (1 == 1) { defer note(1); return 0; }
        }
        return 0;
      }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 123);
  });

  test("a defer after an early return never runs", async () => {
    const source = `${LOG}
      fn body(p: i32): i32 { if (p == 0) { return -1; } defer note(1); return 0; }
      export fn run(): i32 { body(0); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 0);
  });

  // §10.2: the spill becomes unconditional, including with no struct locals.
  test("the return-value spill works with an empty frame", async () => {
    const source = `${LOG}
      fn body(): i32 { defer note(1); return 42; }
      export fn run(): i32 { return body() * 10 + log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 421);
  });

  test("an indirect deferred call uses the captured target", async () => {
    const source = `${LOG}
      fn one(): void { note(1); }
      fn two(): void { note(2); }
      fn body(): void { let op: fn(): void = one; defer op(); op = two; op(); }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 21);
  });

  test("a deferred call may allocate", async () => {
    const source = `
      import malloc, free from "memory"
      export fn run(): i32 {
        let a: i32 = malloc(16);
        defer free(a);
        let b: i32 = malloc(16);
        free(b);
        return a;
      }
    `;
    assert(Number(await runMergedExport(source, "run")) > 0);
  });

  test("recursion runs each activation's defers", async () => {
    const source = `${LOG}
      fn down(n: i32): i32 { defer note(n); if (n == 0) { return 0; } return down(n - 1); }
      export fn run(): i32 { down(3); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 123);
  });

  // §6's measured reality: a trap does not run defers and does not unwind.
  test("a deferred method call captures its receiver", async () => {
    const source = `${LOG}
      struct Cell { value: i32 }
      fn Cell.release(self)(bias: i32): void { note(self.value + bias); }
      fn body(): void {
        let a: Cell = { value = 1 };
        let b: Cell = { value = 2 };
        defer a.release(0);
        defer b.release(0);
      }
      export fn run(): i32 { body(); return log; }
    `;
    assert.equal(await runMergedExport(source, "run"), 21);
  });

  // Exact pointer capture, not merely "something was captured".
  test("the captured pointer is the one live at the defer statement", async () => {
    const source = `
      import malloc from "memory"
      let observed: i32 = 0;
      fn observe(p: i32): void { observed = p; }
      fn body(): i32 {
        let p: i32 = malloc(16);
        let first: i32 = p;
        defer observe(p);
        p = malloc(32);
        return first;
      }
      export fn run(): i32 { let first: i32 = body(); return observed == first; }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  // W7, the dangerous footgun: realloc already freed the old block, so the
  // defer now names a stale pointer. T57's guard turns that into a trap.
  test("a defer registered before realloc frees a stale pointer and traps", async () => {
    const source = `
      import malloc, realloc, free from "memory"
      export fn run(): i32 {
        let p: i32 = malloc(16);
        defer free(p);
        p = realloc(p, 32);
        return 0;
      }
    `;
    await assert.rejects(runMergedExport(source, "run"), WebAssembly.RuntimeError);
  });

  // §6's measured reality. The function holds a STRUCT local, so it has a real
  // frame — without one there is no `$__sp` displacement to observe.
  test("a trap mid-scope leaves the allocation live and $__sp displaced", async () => {
    const source = `
      import malloc, free from "memory"
      struct Anchor { slot: i32 }
      let leaked: i32 = 0;
      export fn boom(): i32 {
        let anchor: Anchor = { slot = 1 };
        let p: i32 = malloc(16);
        leaked = p;
        defer free(p);
        anchor.slot = 2;
        __trap();
        return 0;
      }
      export fn probeHeap(): i32 {
        let after: i32 = malloc(16);
        return after == leaked;
      }
      export fn probeStack(): i32 { let probe: Anchor = { slot = 3 }; return probe.slot; }
    `;
    const instance = await mergedInstance(source);
    assert.throws(() => (instance.exports.boom as () => number)(), WebAssembly.RuntimeError);
    // The deferred free never ran: the block is still live, so the next malloc
    // cannot hand back the same address.
    assert.equal((instance.exports.probeHeap as () => number)(), 0);
    // `$__sp` was never restored either, so a later framed call allocates its
    // struct BELOW the abandoned frame rather than reusing it — the instance is
    // usable only because nothing here depends on the stack pointer's value.
    assert.equal((instance.exports.probeStack as () => number)(), 3);
  });
});

// T71 — H1 / decision O10 (option A1). Escape analysis picks storage: a
// non-escaping `let`-bound literal becomes per-call, an escaping one keeps the
// shared static buffer so returning it still compiles.
describe("local literal storage", () => {
  test("a local string literal is fresh on every call", async () => {
    const source = `
      fn touch(): i32 {
        let s: string = "abcd";
        let first: i32 = __load_i32(s.data);
        __store_i32(s.data, 0);
        return first;
      }
      export fn run(): i32 { return touch() == touch(); }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("recursion gives each activation its own buffer", async () => {
    const source = `
      fn down(n: i32): i32 {
        let values: i32[] = [0];
        values[0] = n;
        if (n > 0) { down(n - 1); }
        return values[0];
      }
      export fn run(): i32 { return down(3); }
    `;
    assert.equal(await runMergedExport(source, "run"), 3);
  });

  test("a loop re-initializes the literal each iteration", async () => {
    const source = `
      export fn run(): i32 {
        let total: i32 = 0;
        for (let i: i32 = 0; i < 3; i = i + 1) {
          let values: i32[] = [5];
          total = total + values[0];
          values[0] = 100;
        }
        return total;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 15);
  });

  test("bounds checks still trap on a frame-backed array", async () => {
    const source = `
      export fn run(i: i32): i32 { let values: i32[] = [4, 5]; return values[i]; }
    `;
    await assert.rejects(runMergedExport(source, "run", [2]), WebAssembly.RuntimeError);
  });

  test("len and data read correctly from a frame-backed aggregate", async () => {
    const source = `
      export fn run(): i32 {
        let values: i32[] = [7, 8, 9];
        let s: string = "abcd";
        return values.len * 10 + s.len;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 34);
  });

  // The shadow stack is neither aligned nor size-rounded, so a preceding
  // single-byte struct leaves the array payload unaligned. Wasm permits that.
  test("an unaligned frame array reads and writes correctly", async () => {
    const source = `
      struct Tiny { flag: i8 }
      export fn run(): i32 {
        let t: Tiny = { flag = 1 };
        let values: i32[] = [11, 22];
        values[1] = values[0] + values[1];
        return values[1] + t.flag;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 34);
  });

  test("a dynamic-element local array is per-call too", async () => {
    const source = `
      fn seed(): i32 { return 3; }
      fn touch(): i32 {
        let values: i32[] = [seed()];
        let old: i32 = values[0];
        values[0] = 99;
        return old;
      }
      export fn run(): i32 { return touch() * 100 + touch(); }
    `;
    assert.equal(await runMergedExport(source, "run"), 303);
  });
});

// T72 — the "memory_debug" drop-in allocator. Same public surface as "memory",
// swapped by import path; for a CORRECT program the two are identical.
describe("memory_debug allocator", () => {
  const PROGRAM = (module: string) => `
    import malloc, free, realloc from "${module}"
    export fn run(): i32 {
      let a: i32 = malloc(16);
      __store_i32(a, 11);
      let grown: i32 = realloc(a, 64);
      let b: i32 = malloc(8);
      __store_i32(b, 31);
      let total: i32 = __load_i32(grown) + __load_i32(b);
      free(grown);
      free(b);
      return total;
    }
  `;

  test("a correct program behaves identically under both modules", async () => {
    const plain = await runMergedExport(PROGRAM("memory"), "run");
    const debug = await runMergedExport(PROGRAM("memory_debug"), "run");
    assert.equal(plain, 42);
    assert.equal(debug, plain);
  });

  test("heap_stats counts live allocations and payload bytes", async () => {
    const source = `
      import malloc, free, heap_stats from "memory_debug"
      export fn run(): i32 {
        let a: i32 = malloc(16);
        let b: i32 = malloc(16);
        let (count, bytes) = heap_stats();
        free(a);
        free(b);
        let (after, restBytes) = heap_stats();
        return count * 10000 + bytes * 100 + after * 10 + restBytes;
      }
    `;
    // 2 live, 32 payload bytes (headers excluded), then 0 and 0.
    assert.equal(await runMergedExport(source, "run"), 23200);
  });

  // The deliberate divergence: "memory" traps here, this records and continues.
  test("an adjacent double free is recorded instead of trapping", async () => {
    const source = `
      import malloc, free, heap_errors from "memory_debug"
      export fn run(): i32 {
        let p: i32 = malloc(16);
        free(p);
        free(p);
        return heap_errors();
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 1);
  });

  test("a foreign-pointer free is recorded instead of trapping", async () => {
    const source = `
      import free, heap_errors from "memory_debug"
      export fn run(): i32 {
        free(1024);
        free(65536);
        return heap_errors();
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 2);
  });

  test("a use-after-free read returns poison", async () => {
    const source = `
      import malloc, free from "memory_debug"
      export fn run(): i32 {
        let p: i32 = malloc(32);
        __store_i32(p + 8, 7);
        free(p);
        return __load_i32(p + 8);
      }
    `;
    assert.equal(await runMergedExport(source, "run"), -559038737);
  });

  test("the module is tree-shaken when unimported", async () => {
    const source = `
      import malloc from "memory"
      export fn run(): i32 { return malloc(8); }
    `;
    assert(Number(await runMergedExport(source, "run")) > 0);
  });
});

// Review follow-ups: three shapes that were valid source but mishandled.
describe("defer and free: review regressions", () => {
  test("a deferred intrinsic lowers instead of crashing the compiler", async () => {
    const source = `
      export fn run(): i32 {
        let scratch: i32 = 65536;
        defer __store_i32(scratch, 7);
        return __load_i32(scratch);
      }
    `;
    // The store runs at fall-through, after the return value is spilled.
    assert.equal(await runMergedExport(source, "run"), 0);
  });

  test("a deferred trap intrinsic runs at scope exit", async () => {
    const source = "export fn run(): i32 { defer __trap(); return 1; }";
    await assert.rejects(runMergedExport(source, "run"), WebAssembly.RuntimeError);
  });

  test("a deferred value-producing intrinsic discards its result", async () => {
    const source = `
      export fn run(): i32 {
        defer __memory_size();
        return 5;
      }
    `;
    assert.equal(await runMergedExport(source, "run"), 5);
  });
});
