import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ASTProgram } from "../parser/ast/ASTProgram";
import { Parser } from "../parser/Parser";
import type { ModuleMeta } from "./emitters/emitter.types";
import { emitMergedProgram } from "./emitters/merge";
import { buildMergedProgram } from "./emitters/merge-model";
import { extractModuleMeta } from "./emitters/module";
import {
  buildModuleGraph,
  type ResolvedImportModule,
  resolveBundledStdlibModule,
  resolveImportModule,
} from "./module-graph";
import { typeCheck } from "./TypeChecker";

export type { ResolvedImportModule };
export { resolveImportModule };

/** Resolve stdlib imports on a single module (tests, tooling). */
export function linkStdlibImports(meta: ModuleMeta): void {
  for (const [impName, imp] of Object.entries(meta.imports)) {
    if (imp.resolved) {
      continue;
    }
    const resolvedModule = resolveBundledStdlibModule(imp.module);
    if (!resolvedModule) {
      continue;
    }
    const stdMod = resolvedModule.data;
    const entry = stdMod.exports[impName];
    if (!entry) {
      throw new Error(`no export "${impName}" from stdlib "${imp.module}"`);
    }
    imp.info = entry;
    imp.resolved = true;
  }
}

//
// Compilation pipeline (current):
//
//  1) Parse entry + imported modules
//     - build ASTs
//     - extract ModuleMeta for each module
//
//  2) Resolve imports/exports across stdlib + user modules
//     - attach resolved import metadata (function/global/struct signatures)
//
//  3) Validation pass
//     - run typeCheck() over each module before emission
//
//  4) Build the whole-program model and emit one WAT module
//
//  5) Assemble the final WebAssembly module with wat2wasm
//
// Next idea status:
//   1) Optimization pass (constant folding/static simplification): pending.
//

async function openFile(fp: string): Promise<string> {
  const res = await readFile(fp);
  return res.toString();
}

function parseFile(name: string, text: string): ASTProgram | null {
  const p = new Parser(text, name);
  const ast = p.parse(name);
  if (p.errors.length) {
    for (const error of p.errors) {
      console.error(error.format());
    }
    return null;
  }
  return ast;
}

export async function compiler(
  entryPoint: string,
  entryMod: string,
  cwd: string,
  outputPath = "build/app.wasm",
) {
  const entrySrc = await openFile(entryPoint);
  if (!entrySrc) {
    return;
  }

  const entryAST = parseFile(entryMod, entrySrc);
  if (!entryAST) {
    return;
  }
  const data = extractModuleMeta(entryAST, true);
  const absoluteEntryPath = path.resolve(cwd, entryPoint);
  const graph = buildModuleGraph(absoluteEntryPath, {
    entryModule: {
      kind: "maple",
      path: absoluteEntryPath,
      ast: entryAST,
      data,
    },
  });

  // 2. Link module imports/exports
  for (const mod of graph.modules.values()) {
    const data = mod.data;
    for (const [impName, imp] of Object.entries(data.imports)) {
      if (imp.resolved) {
        continue;
      }
      const dependency = mod.dependencies.find((entry) => entry.specifier === imp.module);
      if (dependency?.kind === "external") {
        continue;
      }
      const userEntry = dependency ? graph.modules.get(dependency.key) : undefined;
      if (!userEntry) {
        throw new Error(`no module "${imp.module}" found`);
      }
      const entry = userEntry.data.exports[impName];
      if (!entry) {
        throw new Error(`no function "${impName}" exported from stdlib "${imp.module}"`);
      }
      // hook up the export -> import
      imp.info = entry;
      imp.resolved = true;
      imp.mergeable = true;
    }
  }

  // Validation pass — type checker
  for (const mod of graph.modules.values()) {
    const typeErrors = typeCheck(mod.ast, mod.data);
    if (typeErrors.length > 0) {
      for (const e of typeErrors) {
        console.error(e.format());
      }
      return null;
    }
  }
  // @TODO: Optimization pass

  const model = buildMergedProgram(graph);
  const wat = emitMergedProgram(model);
  const outputDir = path.dirname(outputPath);
  await mkdir(outputDir, { recursive: true });
  const watPath = outputPath.endsWith(".wasm")
    ? `${outputPath.slice(0, -".wasm".length)}.wat`
    : `${outputPath}.wat`;
  await writeFile(watPath, wat);
  await run("wat2wasm", [watPath, "-o", outputPath]);
  console.log(`Compiled: ${outputPath}`);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      if (stderr) console.error(stderr);
      if (stdout) console.log(stdout);
      resolve();
    });
  });
}
