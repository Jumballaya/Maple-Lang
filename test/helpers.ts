import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { linkStdlibImports } from "../src/compiler/compiler";
import {
  collectFnReferences,
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

export function compile(src: string): string {
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
  return emitModule(ast, meta).buildWat();
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

/** i64-returning exports yield BigInt; assert against `123n`, not `123`. */
export function runExport(wat: string, fnName: string, args: (number | bigint)[] = []): unknown {
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
    const bytes = readFileSync(wasmFile);
    const module = new WebAssembly.Module(bytes);
    const memory = new WebAssembly.Memory({ initial: 2 });
    const instance = new WebAssembly.Instance(module, { runtime: { memory } });
    const fn = instance.exports[fnName];
    if (typeof fn !== "function") {
      throw new Error(`export ${fnName} is not a function`);
    }
    return (fn as (...fnArgs: (number | bigint)[]) => unknown)(...args);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
