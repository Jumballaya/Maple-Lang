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
import { StringLiteralExpression } from "../../parser/ast/expressions/StringLiteral.js";
import { ArrayLiteralExpression } from "../../parser/ast/expressions/ArrayLiteralExpression.js";
import { StructLiteralExpression } from "../../parser/ast/expressions/StructLiteralExpression.js";
import { StructStatement } from "../../parser/ast/statements/StructStatement.js";
import { FunctionStatement } from "../../parser/ast/statements/FunctionStatement.js";
import { ImportStatement } from "../../parser/ast/statements/ImportStatement.js";

function emitGlobal(stmt: LetStatement, emitter: ModuleEmitter): void {
  const name = stmt.identifier;
  const type = stmt.typeAnnotation;
  const value = emitExpression(stmt.expression!, emitter);
  const expr = stmt.expression;

  // string/array literal
  if (
    expr instanceof StringLiteralExpression ||
    expr instanceof ArrayLiteralExpression ||
    expr instanceof StructLiteralExpression
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
  for (const stmt of program.statements) {
    if (stmt instanceof StructStatement) {
      const { name, members, size } = stmt;
      builder.defStruct({ name, members, size });
      // @TODO: Figure out how to fold in struct export/import
    }
  }

  // parse for functions at top level
  for (const stmt of program.statements) {
    if (stmt instanceof FunctionStatement) {
      if (!stmt.name) {
        continue;
      }
      const { exported, name } = stmt;
      const { params, returnType } = stmt.fnExpr;
      const signature = generateFunctionSignature(stmt);
      builder.defFunc(name, {
        exported,
        result: returnType ? valueTypeToWasm(returnType) : "void",
        params: params.map(({ identifier, type }) => ({
          name: identifier.tokenLiteral(),
          type,
          scope: "local",
        })),
        signature,
      });
      if (exported) {
        builder.defExport(name, { kind: "func", signature });
      }
    }
  }

  // get imports
  for (const stmt of program.statements) {
    if (stmt instanceof ImportStatement) {
      for (const imp of stmt.imported) {
        builder.defImport(imp, stmt.importPath, imp);
      }
    }
  }

  // get globals
  for (const stmt of program.statements) {
    if (stmt instanceof LetStatement) {
      const name = stmt.identifier;
      const type = stmt.typeAnnotation;

      builder.defGlobal({
        name: name.tokenLiteral(),
        type,
        scope: "global",
      });
      if (stmt.exported) {
        builder.defExport(name.tokenLiteral(), { kind: "global", type });
      }
    }
  }

  for (const stmt of program.statements) {
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
  for (const stmt of ast.statements) {
    if (stmt instanceof ImportStatement) {
      for (const imp of stmt.imported) {
        const impData = ctx.mod.imports[imp];
        const info = impData?.info;
        if (info && info.kind === "func") {
          const sig = extractFunctionSignature(info.signature);
          const [params, results, typeName] = sig;
          emitter.addImportWat(
            `(import "${stmt.importPath}" "${imp}" (func $${imp} (type ${typeName})))`
          );
          emitter.addSignatureWat(
            emitFunctionSignature(typeName, params, results)
          );
        }
      }
    }
    if (stmt instanceof LetStatement) {
      emitGlobal(stmt, emitter);
    }
    if (stmt instanceof FunctionStatement) {
      emitFunction(stmt, emitter);
    }
  }

  return emitter.build();
}
