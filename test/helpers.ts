import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type CompilerOptions,
  compiler,
  linkStdlibImports,
  prepareValidatedModule,
} from "../src/compiler/compiler";
import { collectFnReferences, extractModuleMeta } from "../src/compiler/module-metadata";
import { typeCheck } from "../src/compiler/TypeChecker";
import type { IrModule } from "../src/ir/ir";
import { lowerModule } from "../src/ir/lower";
import { Parser } from "../src/parser/Parser";
import { runEncoded } from "./ir-fixtures";

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

export function compile(
  src: string,
  options: Pick<CompilerOptions, "importMemory"> = { importMemory: false },
): IrModule {
  const parser = new Parser(src);
  const ast = parser.parse("integration");
  assert.equal(
    parser.errors.length,
    0,
    `Parse errors: ${parser.errors.map((error) => error.message).join("; ")}`,
  );
  const meta = extractModuleMeta(ast, true);
  collectFnReferences(ast, meta);
  linkStdlibImports(meta);
  assert.deepEqual(
    typeCheck(ast, meta).map((error) => error.message),
    [],
  );
  const result = lowerModule(ast, meta, options);
  assert.deepEqual(result.pendingInits, []);
  return prepareValidatedModule(result.module, []);
}

/** i64-returning exports yield BigInt; assert against `123n`, not `123`. */
export function runExport(
  module: IrModule,
  fnName: string,
  args: (number | bigint)[] = [],
  imports?: WebAssembly.Imports,
): unknown {
  return runEncoded(module, fnName, args, imports);
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
