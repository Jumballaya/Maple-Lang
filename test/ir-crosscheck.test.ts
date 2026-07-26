/**
 * This deliberately duplicates test/helpers.ts's gate/spawn shape: T52 removes its spawn path
 * and T53 removes its gate. Non-npm runs without the wabt shim silently skip these checks.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { encodeWasm } from "../src/ir/encode-wasm";
import { printWat } from "../src/ir/print-wat";
import {
  ADOPTED_PRINTER_CASE_NAMES,
  binopCases,
  type CrosscheckCase,
  conversionCases,
  crosscheckCases,
  FAILURE_CASE_NAMES,
  MODULE_SURFACE_CASE_NAMES,
  memoryAccessCases,
  unopCases,
} from "./ir-fixtures";

type Outcome =
  | { ok: true; call?: unknown; observation?: unknown }
  | {
      ok: false;
      stage: "construction" | "instantiation" | "call" | "observation";
      errorConstructor: string;
    };

type BackendRun = {
  outcome: Outcome;
  moduleImports?: WebAssembly.ModuleImportDescriptor[];
  moduleExports?: WebAssembly.ModuleExportDescriptor[];
  instanceExports?: string[];
};

function probeWat2Wasm(): boolean {
  const skip = Boolean(process.env.MAPLE_SKIP_WAT2WASM);
  const requireWat2Wasm = Boolean(process.env.MAPLE_REQUIRE_WAT2WASM);
  if (skip && requireWat2Wasm) {
    throw new Error("wat2wasm is required but MAPLE_SKIP_WAT2WASM is set");
  }
  if (skip) return false;
  try {
    execFileSync("wat2wasm", ["--version"], { stdio: "ignore" });
    return true;
  } catch (error) {
    if (requireWat2Wasm) {
      throw new Error("wat2wasm is required but unavailable", { cause: error });
    }
    return false;
  }
}

const wat2wasmAvailable = probeWat2Wasm();

function crosscheckTest(name: string, fn: () => void): void {
  if (wat2wasmAvailable) test(name, fn);
  else test.skip(`[needs wat2wasm] ${name}`, fn);
}

function assembleWat(wat: string): Uint8Array {
  const directory = mkdtempSync(join(tmpdir(), "maple-crosscheck-"));
  const watPath = join(directory, "module.wat");
  const wasmPath = join(directory, "module.wasm");
  writeFileSync(watPath, wat);
  try {
    const result = spawnSync("wat2wasm", [watPath, "-o", wasmPath], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`wat2wasm failed: ${result.stderr}`);
    return new Uint8Array(readFileSync(wasmPath));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function failed(
  stage: Extract<Outcome, { ok: false }>["stage"],
  error: unknown,
): Extract<Outcome, { ok: false }> {
  return {
    ok: false,
    stage,
    errorConstructor: error instanceof Error ? error.constructor.name : typeof error,
  };
}

function runBackend(bytes: () => Uint8Array, fixture: CrosscheckCase): BackendRun {
  let module: WebAssembly.Module;
  try {
    module = new WebAssembly.Module(bytes() as Uint8Array<ArrayBuffer>);
  } catch (error) {
    return { outcome: failed("construction", error) };
  }

  const moduleImports = WebAssembly.Module.imports(module);
  const moduleExports = WebAssembly.Module.exports(module);
  const imports = fixture.imports?.() ?? {};
  let instance: WebAssembly.Instance;
  try {
    instance = new WebAssembly.Instance(module, imports);
  } catch (error) {
    return {
      outcome: failed("instantiation", error),
      moduleImports,
      moduleExports,
    };
  }

  const instanceExports = Object.keys(instance.exports);
  const outcome: Extract<Outcome, { ok: true }> = { ok: true };
  if (fixture.entry !== undefined) {
    try {
      const exported = instance.exports[fixture.entry];
      if (typeof exported !== "function") throw new TypeError("entry export is not a function");
      outcome.call = (exported as (...args: Array<number | bigint>) => unknown)(
        ...(fixture.args ?? []),
      );
    } catch (error) {
      return {
        outcome: failed("call", error),
        moduleImports,
        moduleExports,
        instanceExports,
      };
    }
  }
  if (fixture.observe !== undefined) {
    try {
      outcome.observation = fixture.observe(instance, imports);
    } catch (error) {
      return {
        outcome: failed("observation", error),
        moduleImports,
        moduleExports,
        instanceExports,
      };
    }
  }
  return { outcome, moduleImports, moduleExports, instanceExports };
}

function crosscheckRuns(fixture: CrosscheckCase): { encoded: BackendRun; printed: BackendRun } {
  return {
    encoded: runBackend(() => encodeWasm(fixture.module), fixture),
    printed: runBackend(() => assembleWat(printWat(fixture.module)), fixture),
  };
}

function assertCrosscheck(fixture: CrosscheckCase): void {
  const { encoded, printed } = crosscheckRuns(fixture);
  assert.deepEqual(encoded.moduleImports, printed.moduleImports);
  assert.deepEqual(encoded.moduleExports, printed.moduleExports);
  assert.deepEqual(encoded.instanceExports, printed.instanceExports);
  assert.deepEqual(encoded.outcome, printed.outcome);
}

test("cross-check adoption catalog is exactly complete", () => {
  const expected = [
    ...binopCases(),
    ...unopCases(),
    ...conversionCases(),
    ...memoryAccessCases(),
  ].map(({ name }) => name);
  expected.push(...ADOPTED_PRINTER_CASE_NAMES, ...MODULE_SURFACE_CASE_NAMES, ...FAILURE_CASE_NAMES);

  assert.deepEqual(crosscheckCases.map(({ name }) => name).sort(), expected.sort());
});

crosscheckTest("import failures have exact LinkError stage parity", () => {
  for (const name of FAILURE_CASE_NAMES) {
    const fixture = crosscheckCases.find((entry) => entry.name === name)!;
    const { encoded, printed } = crosscheckRuns(fixture);
    const expected: Outcome = {
      ok: false,
      stage: "instantiation",
      errorConstructor: "LinkError",
    };
    assert.deepEqual(encoded.outcome, expected, name);
    assert.deepEqual(printed.outcome, expected, name);
  }
});

crosscheckTest("start and call traps retain distinct stages", () => {
  const start = crosscheckCases.find((entry) => entry.name === "surface trapping start")!;
  const call = crosscheckCases.find((entry) => entry.name === "surface trapping call")!;
  for (const outcome of Object.values(crosscheckRuns(start)).map((run) => run.outcome)) {
    assert.deepEqual(outcome, {
      ok: false,
      stage: "instantiation",
      errorConstructor: "RuntimeError",
    });
  }
  for (const outcome of Object.values(crosscheckRuns(call)).map((run) => run.outcome)) {
    assert.deepEqual(outcome, {
      ok: false,
      stage: "call",
      errorConstructor: "RuntimeError",
    });
  }
});

crosscheckTest("successful outcomes retain both call and observation", () => {
  const fixture = crosscheckCases.find((entry) => entry.name === "surface successful start")!;
  for (const outcome of Object.values(crosscheckRuns(fixture)).map((run) => run.outcome)) {
    assert.deepEqual(outcome, { ok: true, call: 9, observation: 9 });
  }
});

crosscheckTest("canonical NaN payload bits agree at both widths", () => {
  const expected = new Map<string, number | bigint>([
    ["surface canonical f32 NaN bits", 0x7fc0_0000],
    ["surface canonical f64 NaN bits", 0x7ff8_0000_0000_0000n],
  ]);
  for (const [name, bits] of expected) {
    const fixture = crosscheckCases.find((entry) => entry.name === name)!;
    for (const outcome of Object.values(crosscheckRuns(fixture)).map((run) => run.outcome)) {
      assert.deepEqual(outcome, { ok: true, call: bits }, name);
    }
  }
});

for (const fixture of crosscheckCases) {
  crosscheckTest(`encoder and printer agree: ${fixture.name}`, () => {
    assertCrosscheck(fixture);
  });
}
