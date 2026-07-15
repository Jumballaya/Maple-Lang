import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe } from "node:test";
import { fileURLToPath } from "node:url";
import { compile, maybeTest } from "./helpers";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const MATH_MAPLE = join(__dirname, "../src/compiler/stdlib/math.maple");

const EPS_F = 5e-4;
const EPS_ATAN2 = 5e-3;
const EPS_TAN = 1e-3;

function assertNearF(a: number, b: number, eps: number, msg?: string): void {
  assert.ok(Math.abs(a - b) <= eps, msg ?? `expected ${a} ≈ ${b} (eps ${eps})`);
}

async function loadMathWasm(): Promise<WebAssembly.Instance> {
  const dir = mkdtempSync(join(tmpdir(), "maple-math-"));
  const watPath = join(dir, "m.wat");
  const wasmPath = join(dir, "m.wasm");
  try {
    const wat = compile(readFileSync(MATH_MAPLE, "utf8"));
    writeFileSync(watPath, wat);
    execFileSync("wat2wasm", [watPath, "-o", wasmPath], { stdio: "pipe" });
    const buf = readFileSync(wasmPath);
    const memory = new WebAssembly.Memory({ initial: 2 });
    const { instance } = await WebAssembly.instantiate(buf, { runtime: { memory } });
    return instance;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("stdlib math.maple (Tier 1)", () => {
  maybeTest("opcode-backed f32 helpers are exact at spot values", async () => {
    const i = await loadMathWasm();
    const e = i.exports as Record<string, WebAssembly.ExportValue>;
    assert.equal((e.sqrt as (x: number) => number)(4), 2);
    assert.equal((e.sqrt as (x: number) => number)(0), 0);
    assert.equal((e.abs_f32 as (x: number) => number)(-1.5), 1.5);
    assert.equal((e.floor as (x: number) => number)(3.7), 3);
    assert.equal((e.ceil as (x: number) => number)(3.2), 4);
    assert.equal((e.round as (x: number) => number)(2.5), 2);
    assert.equal((e.trunc as (x: number) => number)(-1.9), -1);
    assert.equal((e.copysign as (x: number, y: number) => number)(1, -2), -1);
  });

  maybeTest("opcode-backed f64 mirrors", async () => {
    const i = await loadMathWasm();
    const e = i.exports as Record<string, WebAssembly.ExportValue>;
    assert.equal((e.sqrt_f64 as (x: number) => number)(16), 4);
    assert.equal((e.abs_f64 as (x: number) => number)(-2.5), 2.5);
  });

  maybeTest("abs_i32 branchless edge (INT_MIN)", async () => {
    const i = await loadMathWasm();
    const e = i.exports as Record<string, WebAssembly.ExportValue>;
    const abs_i32 = e.abs_i32 as (x: number) => number;
    assert.equal(abs_i32(-2147483648), -2147483648);
    assert.equal(abs_i32(42), 42);
    assert.equal(abs_i32(-7), 7);
  });
});

describe("stdlib math.maple (Tier 2 accuracy)", () => {
  maybeTest("sin / cos / tan spot checks", async () => {
    const i = await loadMathWasm();
    const e = i.exports as Record<string, WebAssembly.ExportValue>;
    const sin = e.sin as (x: number) => number;
    const cos = e.cos as (x: number) => number;
    const tan = e.tan as (x: number) => number;
    const PI = (e.PI as WebAssembly.Global).value as number;
    const HALF_PI = (e.HALF_PI as WebAssembly.Global).value as number;

    assertNearF(sin(0), 0, EPS_F);
    assertNearF(sin(HALF_PI), 1, EPS_F);
    assertNearF(sin(PI), 0, EPS_F);
    assertNearF(sin(-HALF_PI), -1, EPS_F);

    const x = 3 * PI + 0.1;
    assertNearF(sin(x), sin(PI + 0.1), EPS_F);

    assertNearF(cos(0), 1, EPS_F);
    assertNearF(cos(PI), -1, EPS_F);

    assertNearF(tan(0), 0, EPS_TAN);
    assertNearF(tan(PI * 0.25), 1, EPS_TAN);
  });

  maybeTest("atan2 quadrant spots", async () => {
    const i = await loadMathWasm();
    const e = i.exports as Record<string, WebAssembly.ExportValue>;
    const atan2 = e.atan2 as (y: number, x: number) => number;
    const PI = (e.PI as WebAssembly.Global).value as number;
    const HALF_PI = (e.HALF_PI as WebAssembly.Global).value as number;

    assertNearF(atan2(0, 1), 0, EPS_ATAN2);
    assertNearF(atan2(1, 0), HALF_PI, EPS_ATAN2);
    assertNearF(atan2(-1, -1), (-3 * PI) / 4, EPS_ATAN2);
    assertNearF(atan2(0, -1), PI, EPS_ATAN2);
  });

  maybeTest("atan2 covers all four quadrants within 1e-3", async () => {
    const i = await loadMathWasm();
    const atan2 = i.exports.atan2 as (y: number, x: number) => number;
    for (const [y, x] of [
      [0.1, 1],
      [0.1, -1],
      [-0.1, -1],
      [-0.1, 1],
    ] as const) {
      assertNearF(atan2(y, x), Math.atan2(y, x), 1e-3);
    }
  });

  maybeTest("pow and fmod", async () => {
    const i = await loadMathWasm();
    const e = i.exports as Record<string, WebAssembly.ExportValue>;
    const pow = e.pow as (b: number, exp: number) => number;
    const fmod = e.fmod as (x: number, y: number) => number;

    assert.equal(pow(2, 10), 1024);
    assert.equal(pow(3, 0), 1);
    assertNearF(pow(2, -2), 0.25, EPS_F);

    assertNearF(fmod(5.5, 2.0), 1.5, EPS_F);
    assertNearF(fmod(-5.5, 2.0), -1.5, EPS_F);
    assert.equal(fmod(-7.5, 2.0), -1.5);
  });

  maybeTest("constants are plausible f32 values", async () => {
    const i = await loadMathWasm();
    const e = i.exports as Record<string, WebAssembly.ExportValue>;
    const PI = (e.PI as WebAssembly.Global).value as number;
    assertNearF(PI, Math.PI, 1e-5);
    const sin = e.sin as (x: number) => number;
    assertNearF(sin(PI / 2), 1, EPS_F);
  });
});
