import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IrModule } from "../ir/ir";
import { lowerModule } from "../ir/lower";
import { type IrPass, runPasses } from "../ir/passes";
import { printWat } from "../ir/print-wat";
import { validateModule } from "../ir/validate";
import type { ASTProgram } from "../parser/ast/ASTProgram";
import { Parser } from "../parser/Parser";
import { extractLinkedStructGlobals } from "./emitters/emit.data";
import { canonicalFnType, parseFnType } from "./emitters/emit.types";
import type { ModuleMeta } from "./emitters/emitter.types";
import { buildMergedLoweringInput } from "./emitters/merge";
import { buildMergedProgram } from "./emitters/merge-model";
import { extractModuleMeta } from "./emitters/module";
import {
  buildModuleGraph,
  type ModuleGraph,
  type ModuleRecord,
  type ResolvedImportModule,
  resolveBundledStdlibModule,
  resolveImportModule,
} from "./module-graph";
import { typeCheck } from "./TypeChecker";

export type { ResolvedImportModule };
export { resolveImportModule };

export type CompilerOptions = {
  importMemory: boolean;
};

export function printValidatedModule(module: IrModule, passes: readonly IrPass[]): string {
  runPasses(module, passes);
  const errors = validateModule(module);
  if (errors.length > 0) {
    throw new Error(`IR validation failed:\n${errors.join("\n")}`);
  }
  return printWat(module);
}

function resolveLinkedType(graph: ModuleGraph, module: ModuleRecord, type: string): string {
  if (type.startsWith("*")) return `*${resolveLinkedType(graph, module, type.slice(1))}`;
  if (type.endsWith("[]")) {
    return `${resolveLinkedType(graph, module, type.slice(0, -2))}[]`;
  }
  const fnType = parseFnType(type);
  if (fnType) {
    return canonicalFnType(
      fnType.params.map((entry) => resolveLinkedType(graph, module, entry)),
      fnType.results.map((entry) => resolveLinkedType(graph, module, entry)),
    );
  }
  if (type === "string") return type;
  if (module.data.structs[type]) return `${module.manglePrefix}$$${type}`;
  const imported = module.data.imports[type];
  if (!imported) return type;
  const dependency = module.dependencies.find((entry) => entry.specifier === imported.module);
  if (!dependency || dependency.kind === "external") return type;
  const exporter = graph.modules.get(dependency.key);
  if (exporter?.data.exports[imported.name]?.kind !== "struct") return type;
  return `${exporter.manglePrefix}$$${imported.name}`;
}

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
    if (entry.kind === "func") {
      const target = stdMod.functions[imp.name];
      if (target) {
        imp.mapleParams = target.params.map((param) => param.type);
        imp.mapleResults = [...target.mapleResults];
      }
    }
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
//  4) Build the whole-program model, lower it to IR, and print one WAT module
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
  _cwd: string,
  outputPath = "build/app.wasm",
  options: CompilerOptions = { importMemory: false },
) {
  const absoluteEntryPath = path.resolve(entryPoint);
  const entrySrc = await openFile(absoluteEntryPath);
  if (!entrySrc) {
    return;
  }

  const entryAST = parseFile(entryMod, entrySrc);
  if (!entryAST) {
    return;
  }
  const data = extractModuleMeta(entryAST, true);
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
      if (entry.kind === "struct") {
        imp.typeIdentity = `${userEntry.manglePrefix}$$${entry.meta.name}`;
        imp.structMeta = {
          ...entry.meta,
          name: imp.typeIdentity,
          members: Object.fromEntries(
            Object.entries(entry.meta.members).map(([name, member]) => [
              name,
              { ...member, type: resolveLinkedType(graph, userEntry, member.type) },
            ]),
          ),
        };
      } else if (entry.kind === "global") {
        imp.mapleType = resolveLinkedType(graph, userEntry, entry.type);
      } else {
        const target = userEntry.data.functions[imp.name];
        if (target) {
          imp.mapleParams = target.params.map((param) =>
            resolveLinkedType(graph, userEntry, param.type),
          );
          imp.mapleResults = target.mapleResults.map((result) =>
            resolveLinkedType(graph, userEntry, result),
          );
        }
      }
    }
  }

  for (const mod of graph.modules.values()) {
    extractLinkedStructGlobals(mod.ast, mod.data);
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
  const loweringInput = buildMergedLoweringInput(model);
  const result = lowerModule(loweringInput.ast, loweringInput.meta, {
    importMemory: options.importMemory,
    exportMap: loweringInput.exportMap,
    ...(loweringInput.allocator === undefined ? {} : { allocator: loweringInput.allocator }),
  });
  if (result.pendingInits.length > 0) {
    throw new Error(`lowering left ${result.pendingInits.length} pending initializer(s)`);
  }
  const wat = printValidatedModule(result.module, []);
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
