import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ASTProgram } from "../parser/ast/ASTProgram";
import { Parser } from "../parser/Parser";
import type { ModuleMeta } from "./emitters/emitter.types";
import { collectFnReferences, emitModule, extractModuleMeta } from "./emitters/module";
import type { MapleModule } from "./MapleModule";
import { stdlib } from "./stdlib";
import { typeCheck } from "./TypeChecker";

export type ResolvedImportModule =
  | { kind: "legacy"; data: ModuleMeta }
  | { kind: "maple"; path: string; ast: ASTProgram; data: ModuleMeta };

const localStdlibSourceDir = path.join(__dirname, "stdlib");
const stdlibSourceDir = existsSync(localStdlibSourceDir)
  ? localStdlibSourceDir
  : path.resolve("src/compiler/stdlib");

function bundledStdlibPath(importPath: string): string | undefined {
  if (importPath.includes("/") || importPath.startsWith(".")) {
    return undefined;
  }
  const sourcePath = path.join(stdlibSourceDir, `${importPath}.maple`);
  return existsSync(sourcePath) ? sourcePath : undefined;
}

function parseMapleModule(importPath: string, sourcePath: string): ResolvedImportModule {
  const ast = parseFile(importPath, readFileSync(sourcePath, "utf8"));
  if (!ast) {
    throw new Error(`unable to find module: ${importPath}`);
  }
  return {
    kind: "maple",
    path: sourcePath,
    ast,
    data: extractModuleMeta(ast, true),
  };
}

function resolveStdlibModule(importPath: string): ResolvedImportModule | undefined {
  const sourcePath = bundledStdlibPath(importPath);
  if (sourcePath) {
    return parseMapleModule(importPath, sourcePath);
  }
  const legacy = stdlib[importPath];
  return legacy ? { kind: "legacy", data: legacy } : undefined;
}

export function resolveImportModule(importPath: string, importerDir: string): ResolvedImportModule {
  const stdlibModule = resolveStdlibModule(importPath);
  if (stdlibModule) {
    return stdlibModule;
  }
  return parseMapleModule(importPath, path.join(importerDir, importPath));
}

/** Resolve stdlib imports on a single module (tests, tooling). */
export function linkStdlibImports(meta: ModuleMeta): void {
  for (const [impName, imp] of Object.entries(meta.imports)) {
    if (imp.resolved) {
      continue;
    }
    const resolvedModule = resolveStdlibModule(imp.module);
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
//  4) Emit WAT
//     - emitModule() -> MapleModule
//     - MapleModule.buildWat() -> build/*.wat
//
//  5) Assemble + link
//     - wat2wasm build/*.wat -> build/*.o
//     - copy stdlib *.o files
//     - wasm-ld build/*.o -> final .wasm
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

  const stdLibList: Record<string, ModuleMeta> = {};
  const pass1: Record<string, { data: ModuleMeta; ast: ASTProgram }> = {
    [entryAST.name]: { data, ast: entryAST },
  };

  // 1. Build module data
  for (const imp of Object.values(data.imports)) {
    const resolvedModule = resolveImportModule(imp.module, cwd);
    if (resolvedModule.kind === "legacy") {
      stdLibList[imp.module] = resolvedModule.data;
      continue;
    }
    pass1[imp.module] = { data: resolvedModule.data, ast: resolvedModule.ast };
  }

  // 1b. Collect function references for closure runtime
  for (const mod of Object.values(pass1)) {
    collectFnReferences(mod.ast, mod.data);
  }

  // 1c. Re-scan imports for stdlib modules synthesized in step 1b
  // (collectFnReferences may inject e.g. memory.malloc for __make_fnref).
  for (const mod of Object.values(pass1)) {
    for (const imp of Object.values(mod.data.imports)) {
      const stdMod = stdlib[imp.module];
      if (stdMod && !stdLibList[imp.module]) {
        stdLibList[imp.module] = stdMod;
      }
    }
  }

  // 2. Link module imports/exports
  for (const mod of Object.values(pass1)) {
    const data = mod.data;
    for (const [impName, imp] of Object.entries(data.imports)) {
      if (imp.resolved) {
        continue;
      }
      // see if we have an stdlib import
      const stdLibEntry = stdLibList[imp.module];
      if (stdLibEntry) {
        const entry = stdLibEntry.exports[impName];
        if (!entry) {
          throw new Error(`no function "${impName}" exported from stdlib "${imp.module}"`);
        }
        // hook up the export -> import
        imp.info = entry;
        imp.resolved = true;
        continue;
      }
      // now with the user files
      const userEntry = pass1[imp.module];
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
    }
  }

  // Validation pass — type checker
  for (const mod of Object.values(pass1)) {
    const typeErrors = typeCheck(mod.ast, mod.data);
    if (typeErrors.length > 0) {
      for (const e of typeErrors) {
        console.error(e.format());
      }
      return null;
    }
  }
  // @TODO: Optimization pass

  // step 3. compile
  // Emit code
  const toWrite: MapleModule[] = [];
  for (const mod of Object.values(pass1)) {
    toWrite.push(emitModule(mod.ast, mod.data));
  }

  // create build folder + output destination
  await run("mkdir -p build");
  const outputDir = path.dirname(outputPath);
  if (outputDir && outputDir !== "." && outputDir !== "build") {
    await run(`mkdir -p ${outputDir}`);
  }
  // build .wat files
  const toCompile: string[] = [];
  for (const mod of toWrite) {
    console.log(`Assembling module: ${mod.name}`);
    await writeFile(`build/${mod.name}.wat`, mod.buildWat());
    toCompile.push(mod.name);
  }
  // remove any stale objects from previous builds before assembling
  await run("rm -f build/*.o");
  // compile to wasm
  for (const path of toCompile) {
    await run(`wat2wasm -r build/${path}.wat -o build/${path}.o`);
  }
  // step 4. Linking
  // 4a. get std lib binaries
  for (const bin of Object.values(stdLibList)) {
    await run(`cp src/compiler/stdlib/${bin.name}.o build/${bin.name}.o`);
  }
  await run(`wasm-ld --no-gc-sections --no-check-features build/*.o -o ${outputPath}`);
  console.log(`Compiled: ${outputPath}`);
}

function run(cmd: string): Promise<void> {
  return new Promise((res) => {
    exec(cmd, (exception, out, err) => {
      if (exception) {
        throw exception;
      }
      if (err) {
        console.error(err);
        return;
      }
      if (out) {
        console.log(out);
      }
      res();
    });
  });
}
