import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dumpIr } from "../ir/dump-ir";
import { encodeWasm } from "../ir/encode-wasm";
import type { IrModule } from "../ir/ir";
import { lowerModule } from "../ir/lower";
import { type IrPass, runPasses } from "../ir/passes";
import { printWat } from "../ir/print-wat";
import { validateModule } from "../ir/validate";
import type { ASTProgram } from "../parser/ast/ASTProgram";
import { Parser } from "../parser/Parser";
import { extractLinkedStructGlobals } from "./data-extraction";
import { buildMergedLoweringInput } from "./merge";
import { buildMergedProgram } from "./merge-model";
import { createStructData, type ModuleMeta } from "./metadata";
import {
  buildModuleGraph,
  type ModuleGraph,
  type ModuleRecord,
  type ResolvedImportModule,
  resolveBundledStdlibModule,
  resolveImportModule,
} from "./module-graph";
import { extractModuleMeta } from "./module-metadata";
import { typeCheck } from "./TypeChecker";
import { canonicalFnType, parseFnType } from "./types";

export type { ResolvedImportModule };
export { resolveImportModule };

export type CompilerOptions = {
  importMemory: boolean;
  emitWat?: string;
  emitIr?: string;
  strip?: boolean;
};

export function prepareValidatedModule(module: IrModule, passes: readonly IrPass[]): IrModule {
  runPasses(module, passes);
  const errors = validateModule(module);
  if (errors.length > 0) {
    throw new Error(`IR validation failed:\n${errors.join("\n")}`);
  }
  return module;
}

export function printValidatedModule(module: IrModule, passes: readonly IrPass[]): string {
  return printWat(prepareValidatedModule(module, passes));
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

export function linkModuleGraph(graph: ModuleGraph): void {
  for (const mod of graph.modules.values()) {
    for (const [impName, imp] of Object.entries(mod.data.imports)) {
      if (imp.resolved) continue;
      const dependency = mod.dependencies.find((entry) => entry.specifier === imp.module);
      if (dependency?.kind === "external") continue;
      const exporter = dependency ? graph.modules.get(dependency.key) : undefined;
      if (!exporter) throw new Error(`no module "${imp.module}" found`);
      const entry = exporter.data.exports[impName];
      if (!entry) throw new Error(`no export "${impName}" from "${imp.module}"`);
      imp.info = entry;
      imp.resolved = true;
      imp.mergeable = true;
      if (entry.kind === "struct") {
        imp.typeIdentity = `${exporter.manglePrefix}$$${entry.meta.name}`;
        imp.structMeta = createStructData(
          imp.typeIdentity,
          Object.fromEntries(
            Object.entries(entry.meta.members).map(([name, member]) => [
              name,
              { name, type: resolveLinkedType(graph, exporter, member.type) },
            ]),
          ),
          entry.meta.exported,
        );
      } else if (entry.kind === "global") {
        imp.mapleType = resolveLinkedType(graph, exporter, entry.type);
      } else {
        const target = exporter.data.functions[imp.name];
        if (target) {
          imp.mapleParams = target.params.map((param) =>
            resolveLinkedType(graph, exporter, param.type),
          );
          imp.mapleResults = target.mapleResults.map((result) =>
            resolveLinkedType(graph, exporter, result),
          );
        }
      }
    }
  }
  for (const mod of graph.modules.values()) extractLinkedStructGlobals(mod.ast, mod.data);
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
//  4) Build the whole-program model, lower it to IR, run passes, and validate
//
//  5) Encode WebAssembly bytes and derive any requested debug artifacts
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
  const resolvedOutputPath = path.resolve(outputPath);
  const resolvedEmitWat = options.emitWat === undefined ? undefined : path.resolve(options.emitWat);
  const resolvedEmitIr = options.emitIr === undefined ? undefined : path.resolve(options.emitIr);
  if (resolvedEmitWat === resolvedOutputPath) {
    throw new Error("--emit-wat path collides with the output path");
  }
  if (resolvedEmitIr === resolvedOutputPath) {
    throw new Error("--emit-ir path collides with the output path");
  }
  if (resolvedEmitIr !== undefined && resolvedEmitIr === resolvedEmitWat) {
    throw new Error("--emit-ir path collides with --emit-wat");
  }

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

  linkModuleGraph(graph);

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
  });
  if (result.pendingInits.length > 0) {
    throw new Error(`lowering left ${result.pendingInits.length} pending initializer(s)`);
  }

  const module = prepareValidatedModule(result.module, []);
  const wasm = encodeWasm(module, { strip: options.strip ?? false });
  const wat = options.emitWat === undefined ? undefined : printWat(module);
  const ir = options.emitIr === undefined ? undefined : dumpIr(module);

  const outputPaths = [
    outputPath,
    ...(options.emitWat === undefined ? [] : [options.emitWat]),
    ...(options.emitIr === undefined ? [] : [options.emitIr]),
  ];
  await Promise.all(
    [...new Set(outputPaths.map((artifactPath) => path.dirname(artifactPath)))].map((directory) =>
      mkdir(directory, { recursive: true }),
    ),
  );
  await writeFile(outputPath, wasm);
  if (options.emitWat !== undefined && wat !== undefined) {
    await writeFile(options.emitWat, wat, "utf8");
  }
  if (options.emitIr !== undefined && ir !== undefined) {
    await writeFile(options.emitIr, ir, "utf8");
  }
  console.log(`Compiled: ${outputPath}`);
}
