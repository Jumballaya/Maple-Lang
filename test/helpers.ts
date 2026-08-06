import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** A live instance of a merged program, for tests that call it more than once. */
export async function mergedInstance(source: string): Promise<WebAssembly.Instance> {
  const dir = mkdtempSync(join(tmpdir(), "maple-merged-instance-"));
  const entry = join(dir, "main.maple");
  const output = join(dir, "out.wasm");
  writeFileSync(entry, source);
  try {
    await compiler(entry, "main", dir, output);
    return new WebAssembly.Instance(new WebAssembly.Module(readFileSync(output)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
