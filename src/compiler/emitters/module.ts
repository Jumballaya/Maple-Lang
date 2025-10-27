import { ASTProgram } from "../../parser/ast/ASTProgram.js";
import { LetStatement } from "../../parser/ast/statements/LetStatement.js";
import type { ModuleMeta } from "./emitter.types.js";
import type { MapleModule } from "../MapleModule.js";
import { ModuleBuilder } from "../ModuleBuilder.js";
import { ModuleEmitter } from "../ModuleEmitter.js";
import { extractGlobalData } from "./emit.data.js";
import { valueTypeToWasm } from "./emit.types.js";
import { emitExpression } from "./expression/expression.js";
import {
  emitFunction,
  emitFunctionSignature,
  extractFunctionSignature,
  generateFunctionSignature,
} from "./statement/function.js";

function emitGlobal(stmt: LetStatement, emitter: ModuleEmitter): void {
  const name = stmt.identifier;
  const type = stmt.typeAnnotation;
  const value = emitExpression(stmt.expression, emitter);
  const expr = stmt.expression;

  // string/array literal
  if (
    expr.type === "string_literal" ||
    expr.type === "array_literal" ||
    expr.type === "struct_literal"
  ) {
    // const num = emitNumberGet(expr.location, "i32");
    const num = `(i32.const 10)`;
    emitter.addGlobalWat(
      `(global $${name} (mut ${valueTypeToWasm(type)}) ${num})`
    );
    if (stmt.exported) {
      emitter.addGlobalWat(`(export "${name}" (global $${name}))`);
    }
    return;
  }

  // everything else
  emitter.addGlobalWat(`(global $${name} (mut ${type}) ${value})`);
}

//
//  This build info about the module as the first pass
//  gather data, globals, strings, structs, functions
//  imports and exports. This is to get all this data
//  up front.
//
export function extractModuleMeta(program: ASTProgram): ModuleMeta {
  const builder = new ModuleBuilder(program.name);

  // parse for structs at top level
  for (const stmt of program.body) {
    if (stmt.type === "struct") {
      const { name, members, size } = stmt;
      builder.defStruct({ name, members, size });
      // @TODO: Figure out how to fold in struct export/import
    }
  }

  // parse for functions at top level
  for (const stmt of program.body) {
    if (stmt.type === "function") {
      if (!stmt.name) {
        continue;
      }
      const { exported, name, params, returnType } = stmt;
      const signature = generateFunctionSignature(stmt);
      builder.defFunc(name, {
        exported,
        result: returnType ? valueTypeToWasm(returnType) : "void",
        params: params.map(([name, type]) => ({ name, type, scope: "local" })),
        signature,
      });
      if (exported) {
        builder.defExport(name, { kind: "func", signature });
      }
    }
  }

  // get imports
  for (const stmt of program.body) {
    if (stmt.type === "import") {
      for (const imp of stmt.imported) {
        builder.defImport(imp, stmt.path, imp);
      }
    }
  }

  // get globals
  for (const stmt of program.body) {
    if (stmt.type === "let") {
      const name = stmt.identifier;
      const type = stmt.typeAnnotation;

      builder.defGlobal({
        name,
        type,
        scope: "global",
      });
      if (stmt.exported) {
        builder.defExport(name, { kind: "global", type });
      }
    }
  }

  for (const stmt of program.body) {
    extractGlobalData(stmt, builder);
  }

  return builder.build();
}

export function emitModule(ast: ASTProgram, data: ModuleMeta): MapleModule {
  const emitter = new ModuleEmitter(data);
  const ctx = emitter.ctx;

  // raw strings
  for (const [str, ptr] of Object.entries(ctx.mod.stringPool)) {
    emitter.addDataWat(`(data (offset (i32.const ${ptr})) "${str}")`);
  }

  // structs/arrays
  for (const entry of ctx.mod.data) {
    const { bytes, addr } = entry;
    emitter.addDataWat(`(data (offset (i32.const ${addr})) "${bytes}")`);
  }

  // parse module body
  for (const stmt of ast.body) {
    if (stmt.type === "import") {
      for (const imp of stmt.imported) {
        const impData = ctx.mod.imports[imp];
        const info = impData?.info;
        if (info && info.kind === "func") {
          const sig = extractFunctionSignature(info.signature);
          const [params, results, typeName] = sig;
          emitter.addImportWat(
            `(import "${stmt.path}" "${imp}" (func $${imp} (type ${typeName})))`
          );
          emitter.addSignatureWat(
            emitFunctionSignature(typeName, params, results)
          );
        }
      }
    }
    if (stmt.type === "let") {
      emitGlobal(stmt, emitter);
    }
    if (stmt.type === "function") {
      emitFunction(stmt, emitter);
    }
  }

  return emitter.build();
}
