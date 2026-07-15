import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ASTProgram } from "../parser/ast/ASTProgram";
import { Parser } from "../parser/Parser";
import type { ModuleMeta } from "./emitters/emitter.types";
import { collectFnReferences, extractModuleMeta } from "./emitters/module";

export type ResolvedImportModule = {
  kind: "maple";
  path: string;
  ast: ASTProgram;
  data: ModuleMeta;
};

export type ResolvedExternalModule = {
  kind: "external";
};

export type ResolvedModule = ResolvedImportModule | ResolvedExternalModule;
export type ModuleResolver = (specifier: string, importerDir: string) => ResolvedModule;

export type ExternalModuleRecord = {
  kind: "external";
  specifier: string;
  importerKey: string;
  filePath: undefined;
  children: [];
};

export type ModuleDependency =
  | {
      kind: "maple";
      specifier: string;
      key: string;
    }
  | (ExternalModuleRecord & { key?: undefined });

export type ModuleRecord = {
  kind: "maple";
  key: string;
  manglePrefix: string;
  filePath: string;
  ast: ASTProgram;
  data: ModuleMeta;
  dependencies: ModuleDependency[];
};

export type ModuleGraph = {
  entryKey: string;
  modules: Map<string, ModuleRecord>;
  externals: ExternalModuleRecord[];
};

export type BuildModuleGraphOptions = {
  resolver?: ModuleResolver;
  entryName?: string;
  entryModule?: ResolvedImportModule;
};

const localStdlibSourceDir = path.join(__dirname, "stdlib");
const stdlibSourceDir = existsSync(localStdlibSourceDir)
  ? localStdlibSourceDir
  : path.resolve("src/compiler/stdlib");

function parseMapleModule(name: string, sourcePath: string): ResolvedImportModule {
  const absolutePath = path.resolve(sourcePath);
  const parser = new Parser(readFileSync(absolutePath, "utf8"), name);
  const ast = parser.parse(name);
  if (parser.errors.length > 0) {
    for (const error of parser.errors) {
      console.error(error.format());
    }
    throw new Error(`unable to parse module: ${absolutePath}`);
  }
  return {
    kind: "maple",
    path: absolutePath,
    ast,
    data: extractModuleMeta(ast, true),
  };
}

function bundledStdlibPath(specifier: string): string | undefined {
  if (specifier.includes("/") || specifier.startsWith(".")) {
    return undefined;
  }
  const sourcePath = path.join(stdlibSourceDir, `${specifier}.maple`);
  return existsSync(sourcePath) ? sourcePath : undefined;
}

export function resolveBundledStdlibModule(specifier: string): ResolvedImportModule | undefined {
  const sourcePath = bundledStdlibPath(specifier);
  return sourcePath ? parseMapleModule(specifier, sourcePath) : undefined;
}

export function resolveImportModule(specifier: string, importerDir: string): ResolvedImportModule {
  const stdlibModule = resolveBundledStdlibModule(specifier);
  if (stdlibModule) {
    return stdlibModule;
  }
  return parseMapleModule(specifier, path.resolve(importerDir, specifier));
}

export function mangleModuleKey(key: string): string {
  let result = "";
  for (const byte of Buffer.from(key, "utf8")) {
    const isAlphaNumeric =
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      (byte >= 0x30 && byte <= 0x39);
    result +=
      isAlphaNumeric || byte === 0x5f
        ? String.fromCharCode(byte)
        : `$${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return result;
}

function withoutMapleExtension(value: string): string {
  return value.endsWith(".maple") ? value.slice(0, -".maple".length) : value;
}

function moduleKey(filePath: string, entryDir: string, isEntry: boolean): string {
  const relativePath = isEntry ? path.basename(filePath) : path.relative(entryDir, filePath);
  const posixPath = relativePath.replaceAll(path.sep, "/");
  return withoutMapleExtension(path.posix.normalize(posixPath));
}

function importSpecifiers(data: ModuleMeta): string[] {
  return [...new Set(Object.values(data.imports).map((dependency) => dependency.module))];
}

export function buildModuleGraph(
  entryPath: string,
  options: BuildModuleGraphOptions = {},
): ModuleGraph {
  const absoluteEntryPath = path.resolve(entryPath);
  const entryDir = path.dirname(absoluteEntryPath);
  const resolver = options.resolver ?? resolveImportModule;
  const entryModule =
    options.entryModule ??
    parseMapleModule(options.entryName ?? path.basename(absoluteEntryPath), absoluteEntryPath);
  const modules = new Map<string, ModuleRecord>();
  const externals: ExternalModuleRecord[] = [];
  const states = new Map<string, "visiting" | "visited">();
  const importerChain: string[] = [];

  function visit(resolvedModule: ResolvedImportModule, isEntry = false): string {
    const filePath = path.resolve(resolvedModule.path);
    const key = moduleKey(filePath, entryDir, isEntry);
    const state = states.get(key);
    if (state === "visiting") {
      const cycleStart = importerChain.indexOf(key);
      const cycle = [...importerChain.slice(cycleStart), key];
      throw new Error(`import cycle: ${cycle.join(" -> ")}`);
    }
    if (state === "visited") {
      return key;
    }

    states.set(key, "visiting");
    importerChain.push(key);
    collectFnReferences(resolvedModule.ast, resolvedModule.data);
    const record: ModuleRecord = {
      kind: "maple",
      key,
      manglePrefix: mangleModuleKey(key),
      filePath,
      ast: resolvedModule.ast,
      data: resolvedModule.data,
      dependencies: [],
    };
    modules.set(key, record);

    for (const specifier of importSpecifiers(record.data)) {
      const dependency = resolver(specifier, path.dirname(filePath));
      if (dependency.kind === "external") {
        const external: ExternalModuleRecord = {
          kind: "external",
          specifier,
          importerKey: key,
          filePath: undefined,
          children: [],
        };
        record.dependencies.push(external);
        externals.push(external);
        continue;
      }
      const dependencyKey = visit(dependency);
      record.dependencies.push({ kind: "maple", specifier, key: dependencyKey });
    }

    importerChain.pop();
    states.set(key, "visited");
    return key;
  }

  const entryKey = visit(entryModule, true);
  return { entryKey, modules, externals };
}
