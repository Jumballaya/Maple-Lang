import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compiler, linkStdlibImports } from "../src/compiler/compiler";
import {
  collectFnReferences,
  type EmitOptions,
  emitModule,
  extractModuleMeta,
} from "../src/compiler/emitters/module";
import { Parser } from "../src/parser/Parser";

function probeWat2Wasm(): boolean {
  const skip = Boolean(process.env.MAPLE_SKIP_WAT2WASM);
  const requireWat2Wasm = Boolean(process.env.MAPLE_REQUIRE_WAT2WASM);

  if (skip && requireWat2Wasm) {
    throw new Error("wat2wasm is required but MAPLE_SKIP_WAT2WASM is set");
  }
  if (skip) {
    return false;
  }

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

export function hasWat2Wasm(): boolean {
  return wat2wasmAvailable;
}

export function maybeTest(name: string, fn: () => void | Promise<void>): void {
  if (wat2wasmAvailable) {
    test(name, fn);
  } else {
    test.skip(`[needs wat2wasm] ${name}`, fn);
  }
}

export function compile(src: string, options: EmitOptions = { importMemory: false }): string {
  const parser = new Parser(src);
  const ast = parser.parse("integration");
  assert.equal(
    parser.errors.length,
    0,
    `Parse errors: ${parser.errors.map((error) => error.message).join("; ")}`,
  );
  const meta = extractModuleMeta(ast);
  collectFnReferences(ast, meta);
  linkStdlibImports(meta);
  return emitModule(ast, meta, options).buildWat();
}

export function validateWithWat2Wasm(wat: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), "maple-test-"));
  const watFile = join(dir, "out.wat");
  const wasmFile = join(dir, "out.wasm");
  writeFileSync(watFile, wat);
  try {
    const result = spawnSync("wat2wasm", [watFile, "-o", wasmFile], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      return result.stderr || "wat2wasm failed";
    }
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function memoryMinimumFromWat(wat: string): number {
  const match = wat.match(
    /\(import "runtime" "memory" \(memory (\d+)\)\)|\(memory \(export "memory"\) (\d+)\)/,
  );
  if (!match) throw new Error("missing memory declaration");
  return Number(match[1] ?? match[2]);
}

export type RunExportOptions = {
  importMemory: boolean;
};

function assembleWat(wat: string): WebAssembly.Module {
  const dir = mkdtempSync(join(tmpdir(), "maple-run-"));
  const watFile = join(dir, "out.wat");
  const wasmFile = join(dir, "out.wasm");
  writeFileSync(watFile, wat);
  try {
    const assembly = spawnSync("wat2wasm", [watFile, "-o", wasmFile], {
      encoding: "utf8",
    });
    if (assembly.status !== 0) {
      throw new Error(`wat2wasm failed: ${assembly.stderr}`);
    }
    return new WebAssembly.Module(readFileSync(wasmFile));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function callExport(
  instance: WebAssembly.Instance,
  fnName: string,
  args: (number | bigint)[],
): unknown {
  const fn = instance.exports[fnName];
  if (typeof fn !== "function") {
    throw new Error(`export ${fnName} is not a function`);
  }
  return (fn as (...fnArgs: (number | bigint)[]) => unknown)(...args);
}

/** i64-returning exports yield BigInt; assert against `123n`, not `123`. */
export function runExport(
  wat: string,
  fnName: string,
  args: (number | bigint)[] = [],
  options: RunExportOptions = { importMemory: false },
): unknown {
  const module = assembleWat(wat);
  if (options.importMemory) {
    const memory = new WebAssembly.Memory({ initial: memoryMinimumFromWat(wat) });
    const instance = new WebAssembly.Instance(module, { runtime: { memory } });
    return callExport(instance, fnName, args);
  }
  return callExport(new WebAssembly.Instance(module), fnName, args);
}

export async function runMergedExport(
  source: string,
  fnName: string,
  args: (number | bigint)[] = [],
): Promise<unknown> {
  const dir = mkdtempSync(join(tmpdir(), "maple-merged-run-"));
  const entry = join(dir, "main.maple");
  const output = join(dir, "out.wasm");
  writeFileSync(entry, source);
  try {
    await compiler(entry, "main", dir, output);
    const module = new WebAssembly.Module(readFileSync(output));
    return callExport(new WebAssembly.Instance(module), fnName, args);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
