import type { ASTProgram } from "../../parser/ast/ASTProgram";
import { ArrayLiteralExpression } from "../../parser/ast/expressions/ArrayLiteralExpression";
import { AssignmentExpression } from "../../parser/ast/expressions/AssignmentExpression";
import { CallExpression } from "../../parser/ast/expressions/CallExpression";
import { CastExpression } from "../../parser/ast/expressions/CastExpression";
import { FunctionLiteralExpression } from "../../parser/ast/expressions/FunctionLiteralExpression";
import { Identifier } from "../../parser/ast/expressions/Identifier";
import { IndexExpression } from "../../parser/ast/expressions/IndexExpression";
import { InfixExpression } from "../../parser/ast/expressions/InfixExpression";
import { PostfixExpression } from "../../parser/ast/expressions/PostfixExpression";
import { PrefixExpression } from "../../parser/ast/expressions/PrefixExpression";
import { StringLiteralExpression } from "../../parser/ast/expressions/StringLiteral";
import { StructLiteralExpression } from "../../parser/ast/expressions/StructLiteralExpression";
import { BlockStatement } from "../../parser/ast/statements/BlockStatement";
import { ExpressionStatement } from "../../parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../../parser/ast/statements/ForStatement";
import { FunctionStatement } from "../../parser/ast/statements/FunctionStatement";
import { IfStatement } from "../../parser/ast/statements/IfStatement";
import { ImportStatement } from "../../parser/ast/statements/ImportStatement";
import { LetStatement } from "../../parser/ast/statements/LetStatement";
import { ReturnStatement } from "../../parser/ast/statements/ReturnStatement";
import { StructStatement } from "../../parser/ast/statements/StructStatement";
import { SwitchStatement } from "../../parser/ast/statements/SwitchStatement";
import { TuplePattern } from "../../parser/ast/statements/TuplePattern";
import { WhileStatement } from "../../parser/ast/statements/WhileStatement";
import type { ASTExpression, ASTStatement } from "../../parser/ast/types/ast.type";
import type { MapleModule } from "../MapleModule";
import { ModuleBuilder } from "../ModuleBuilder";
import { ModuleEmitter } from "../ModuleEmitter";
import { extractGlobalData, isConstInitializer } from "./emit.data";
import {
  canonicalFnType,
  fnTypeToSigName,
  isFnType,
  parseFnType,
  valueTypeToWasm,
} from "./emit.types";
import type { ModuleMeta } from "./emitter.types";
import { resetLabels } from "./emitter.utils";
import { emitNumberGet } from "./expression/core";
import { emitExpression } from "./expression/expression";
import { emitRuntimeHelpers } from "./runtime";
import {
  emitFunction,
  emitFunctionSignature,
  extractFunctionSignature,
  generateFunctionSignature,
} from "./statement/function";

function emitGlobal(stmt: LetStatement, emitter: ModuleEmitter): void {
  if (stmt.pattern instanceof TuplePattern) {
    throw new Error("destructuring let is not allowed at module scope");
  }
  const name = stmt.identifier.tokenLiteral();
  const type = stmt.typeAnnotation;
  const expr = stmt.expression;

  const wasmType = valueTypeToWasm(type);

  // string/array/struct literal: the global holds the static-data address
  if (
    expr instanceof StringLiteralExpression ||
    expr instanceof ArrayLiteralExpression ||
    expr instanceof StructLiteralExpression
  ) {
    const typeDecl = stmt.mutable ? `(mut ${wasmType})` : wasmType;
    const num = emitNumberGet(expr.location, "i32");
    emitter.addGlobalWat(`(global $${name} ${typeDecl} ${num})`);
    if (stmt.exported) {
      emitter.addGlobalWat(`(export "${name}" (global $${name}))`);
    }
    return;
  }

  // Non-const initializers start at zero and are assigned by the deferred
  // startup init; forced `mut` so that write validates even for `const`.
  if (expr && !isConstInitializer(expr)) {
    emitter.addGlobalWat(`(global $${name} (mut ${wasmType}) (${wasmType}.const 0))`);
    if (stmt.exported) {
      emitter.addGlobalWat(`(export "${name}" (global $${name}))`);
    }
    return;
  }

  const typeDecl = stmt.mutable ? `(mut ${wasmType})` : wasmType;
  const value = constGlobalValue(expr!, emitter);
  emitter.addGlobalWat(`(global $${name} ${typeDecl} ${value})`);
  if (stmt.exported) {
    emitter.addGlobalWat(`(export "${name}" (global $${name}))`);
  }
}

// Global initializers accept only `<lane>.const`, so fold negated literals
// (`-5` parses as prefix minus) instead of emitting an i32.sub expression.
function constGlobalValue(
  expr: NonNullable<LetStatement["expression"]>,
  emitter: ModuleEmitter,
): string {
  if (expr instanceof PrefixExpression && expr.operator === "-" && expr.right) {
    const inner = emitExpression(expr.right, emitter);
    return inner.replace(/\.const (\S+)/, ".const -$1").trim();
  }
  return emitExpression(expr, emitter);
}

//
//  This build info about the module as the first pass
//  gather data, globals, strings, structs, functions
//  imports and exports. This is to get all this data
//  up front.
//
export function extractModuleMeta(
  program: ASTProgram,
  deferArrayElementErrors = false,
): ModuleMeta {
  const builder = new ModuleBuilder(program.name);

  // parse for structs at top level
  for (const stmt of program.statements) {
    if (stmt instanceof StructStatement) {
      const { name, members, size, exported } = stmt;
      builder.defStruct({ name, members, size, exported });
      if (exported) {
        builder.defExport(name, {
          kind: "struct",
          meta: {
            name,
            members,
            size,
            exported,
          },
        });
      }
    }
  }

  // Built-in string struct (always available)
  if (!builder.getStruct("string")) {
    builder.defStruct({
      name: "string",
      size: 8,
      exported: false,
      members: {
        len: { name: "len", offset: 0, size: 4, type: "i32" },
        data: { name: "data", offset: 4, size: 4, type: "i32" },
      },
    });
  }

  // parse for functions at top level
  for (const stmt of program.statements) {
    if (stmt instanceof FunctionStatement) {
      if (!stmt.name) {
        continue;
      }
      const { exported, name } = stmt;
      const { params, returnTypes } = stmt.fnExpr;
      const signature = generateFunctionSignature(stmt);
      builder.defFunc(name, {
        exported,
        results: returnTypes.map((returnType) => valueTypeToWasm(returnType)),
        mapleResults: returnTypes,
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
      if (stmt.pattern instanceof TuplePattern) {
        continue;
      }
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
    extractGlobalData(stmt, builder, false, deferArrayElementErrors);
  }

  return builder.build();
}

export function collectFnReferences(ast: ASTProgram, mod: ModuleMeta): void {
  let nextSlot = 0;

  // Populate fnSignatures from a fn-type annotation without adding to the fn-table.
  function registerFnTypeSig(typeStr: string): void {
    if (!isFnType(typeStr)) return;
    if (mod.fnSignatures.has(typeStr)) return;
    const parsed = parseFnType(typeStr);
    if (!parsed) return;
    const wasmParams = parsed.params.map((t) => valueTypeToWasm(t));
    const mapleResults = parsed.results.filter((r) => r !== "void");
    const wasmResults = mapleResults.map((t) => valueTypeToWasm(t));
    mod.fnSignatures.set(typeStr, {
      key: typeStr,
      params: wasmParams,
      results: wasmResults,
      isVoid: wasmResults.length === 0,
    });
    // Any fn-type in scope requires the indirect-call runtime (table + helpers),
    // even if no named function in this module is taken by-value: the table must
    // exist for `call_indirect` to validate.
    mod.needsClosureRuntime = true;
  }

  // Register a named function into the fn-table for indirect call support.
  // Skipped if `name` is shadowed by a local variable in the current scope.
  function registerFnRef(name: string, scope: Set<string>): void {
    if (scope.has(name)) return;
    if (mod.fnTable.has(name)) return;
    const fnMeta = mod.functions[name];
    if (!fnMeta) return;

    const wasmParams = fnMeta.params.map((p) => valueTypeToWasm(p.type));
    const wasmResults = fnMeta.results;
    const key = canonicalFnType(wasmParams, wasmResults);
    const slot = nextSlot++;

    mod.fnTable.set(name, {
      slot,
      trampolineName: `__indirect_${name}`,
      originalName: name,
      signatureKey: key,
      isLambda: false,
    });

    if (!mod.fnSignatures.has(key)) {
      mod.fnSignatures.set(key, {
        key,
        params: wasmParams,
        results: wasmResults,
        isVoid: wasmResults.length === 0,
      });
    }

    mod.needsClosureRuntime = true;
  }

  function walkExpr(expr: ASTExpression, scope: Set<string>): void {
    if (expr instanceof Identifier) {
      registerFnRef(expr.tokenLiteral(), scope);
      return;
    }
    if (expr instanceof CallExpression) {
      for (const arg of expr.args) walkExpr(arg, scope);
      return;
    }
    if (expr instanceof InfixExpression) {
      walkExpr(expr.left, scope);
      walkExpr(expr.right, scope);
      return;
    }
    if (expr instanceof PrefixExpression) {
      if (expr.right) walkExpr(expr.right, scope);
      return;
    }
    if (expr instanceof PostfixExpression) {
      if (expr.left) walkExpr(expr.left, scope);
      return;
    }
    if (expr instanceof AssignmentExpression) {
      walkExpr(expr.left, scope);
      if (expr.value) walkExpr(expr.value, scope);
      return;
    }
    if (expr instanceof IndexExpression) {
      walkExpr(expr.left, scope);
      walkExpr(expr.index, scope);
      return;
    }
    if (expr instanceof StructLiteralExpression) {
      for (const v of Object.values(expr.members)) walkExpr(v, scope);
      return;
    }
    if (expr instanceof CastExpression) {
      walkExpr(expr.expr, scope);
      return;
    }
    if (expr instanceof FunctionLiteralExpression) {
      const innerScope = new Set(scope);
      for (const p of expr.params) {
        innerScope.add(p.identifier.tokenLiteral());
        registerFnTypeSig(p.type);
      }
      for (const r of expr.returnTypes) registerFnTypeSig(r);
      walkBlock(expr.body, innerScope);
      return;
    }
    // Leaves: literals, MemberExpression, PointerMemberExpression, ArrayLiteralExpression
  }

  function walkBlock(block: BlockStatement, scope: Set<string>): void {
    // Use a child scope so let-bindings inside a block don't leak outward.
    const localScope = new Set(scope);
    for (const stmt of block.statements) walkStmt(stmt, localScope);
  }

  function walkStmt(stmt: ASTStatement, scope: Set<string>): void {
    if (stmt instanceof LetStatement) {
      if (stmt.expression) walkExpr(stmt.expression, scope);
      registerFnTypeSig(stmt.typeAnnotation);
      // Add binding AFTER walking RHS so the name doesn't shadow itself.
      if (stmt.pattern instanceof TuplePattern) {
        for (const n of stmt.pattern.names) {
          if (n.kind === "name") scope.add(n.value);
        }
      } else {
        scope.add(stmt.pattern.tokenLiteral());
      }
      return;
    }
    if (stmt instanceof ReturnStatement) {
      for (const rv of stmt.returnValues) walkExpr(rv, scope);
      return;
    }
    if (stmt instanceof ExpressionStatement) {
      if (stmt.expression) walkExpr(stmt.expression, scope);
      return;
    }
    if (stmt instanceof IfStatement) {
      walkExpr(stmt.conditionExpr, scope);
      walkBlock(stmt.thenBlock, scope);
      if (stmt.elseBlock) walkBlock(stmt.elseBlock, scope);
      return;
    }
    if (stmt instanceof WhileStatement) {
      walkExpr(stmt.condExpr, scope);
      walkBlock(stmt.loopBody, scope);
      return;
    }
    if (stmt instanceof ForStatement) {
      if (stmt.initBlock.expression) walkExpr(stmt.initBlock.expression, scope);
      if (stmt.conditionExpr.expression) walkExpr(stmt.conditionExpr.expression, scope);
      if (stmt.updateExpr.expression) walkExpr(stmt.updateExpr.expression, scope);
      walkBlock(stmt.loopBody, scope);
      return;
    }
    if (stmt instanceof BlockStatement) {
      walkBlock(stmt, scope);
      return;
    }
    if (stmt instanceof FunctionStatement) {
      const fnScope = new Set(scope);
      for (const p of stmt.fnExpr.params) {
        fnScope.add(p.identifier.tokenLiteral());
        registerFnTypeSig(p.type);
      }
      for (const r of stmt.fnExpr.returnTypes) registerFnTypeSig(r);
      walkBlock(stmt.fnExpr.body, fnScope);
      return;
    }
    if (stmt instanceof SwitchStatement) {
      walkExpr(stmt.switchExpr, scope);
      for (const c of stmt.cases) walkBlock(c.body, scope);
      if (stmt.default) walkBlock(stmt.default, scope);
      return;
    }
  }

  const topScope = new Set<string>();
  for (const stmt of ast.statements) {
    walkStmt(stmt, topScope);
  }

  if (mod.needsClosureRuntime && !mod.imports.alloc) {
    mod.imports.alloc = {
      module: "memory",
      name: "malloc",
      resolved: true,
      synthesized: true,
      info: { kind: "func", signature: "i_i" },
    };
  }
}

function emitSynthesizedImports(emitter: ModuleEmitter): void {
  for (const [name, imp] of Object.entries(emitter.ctx.mod.imports)) {
    if (!imp.synthesized) continue;
    if (!imp.info || imp.info.kind !== "func") continue;
    const sig = extractFunctionSignature(imp.info.signature);
    const [params, results, typeName] = sig;
    emitter.addImportWat(
      `(import "${imp.module}" "${imp.name}" (func $${name} (type ${typeName})))`,
    );
    emitter.addSignatureWat(emitFunctionSignature(typeName, params, results));
  }
}

function emitFnTypeDecls(mod: ModuleMeta, emitter: ModuleEmitter): void {
  for (const [key, sig] of mod.fnSignatures) {
    const sigName = fnTypeToSigName(key);
    let decl = `(type ${sigName} (func (param i32)`;
    for (const p of sig.params) {
      decl += ` (param ${p})`;
    }
    if (!sig.isVoid) {
      decl += ` (result ${sig.results.join(" ")})`;
    }
    decl += "))";
    emitter.addSignatureWat(decl);
  }
}

function emitFnTable(mod: ModuleMeta, emitter: ModuleEmitter): void {
  const entries = [...mod.fnTable.values()].sort((a, b) => a.slot - b.slot);
  const n = entries.length;
  // Always emit a table when the indirect-call runtime is needed (even if empty)
  // so `call_indirect` validates against an existing table 0.
  emitter.addTableWat(`(table $__fn_table ${n} ${n} funcref)`);
  if (n === 0) return;
  // Declarative elem marks the trampolines as address-takable so `ref.func`
  // can reference them. Actual population happens at runtime inside
  // __make_fnref (see emitMakeFnRefHelper) performs table initialization.
  const trampolines = entries.map((e) => `$${e.trampolineName}`).join(" ");
  emitter.addElemWat(`(elem declare func ${trampolines})`);
}

function emitTrampolines(mod: ModuleMeta, emitter: ModuleEmitter): void {
  for (const [originalName, entry] of mod.fnTable) {
    const fnMeta = mod.functions[originalName];
    if (!fnMeta) continue;

    // Exporting the trampoline serves two purposes:
    //   1. It marks the function as address-takable (reference-types spec),
    //      which is required for `ref.func $__indirect_*` inside __make_fnref.
    //   2. It preserves the existing address-take hint for compatibility.
    // The export name is internal (`__indirect_*`) and not part of the user
    // API surface.
    let wat = `(func $${entry.trampolineName} (export "${entry.trampolineName}") (param $__env i32)`;
    for (const p of fnMeta.params) {
      wat += ` (param $${p.name} ${valueTypeToWasm(p.type)})`;
    }
    if (fnMeta.results.length > 0) {
      wat += ` (result ${fnMeta.results.join(" ")})`;
    }
    wat += `\n  (call $${originalName}`;
    for (const p of fnMeta.params) {
      wat += ` (local.get $${p.name})`;
    }
    wat += "))";

    emitter.addFunctionWat(wat);
  }
}

function emitMakeFnRefHelper(mod: ModuleMeta, emitter: ModuleEmitter): void {
  const entries = [...mod.fnTable.values()].sort((a, b) => a.slot - b.slot);

  // Guard global: table population runs exactly once, on the first
  // __make_fnref call.
  emitter.addGlobalWat("(global $__fn_table_inited (mut i32) (i32.const 0))");

  const lines: string[] = [];
  lines.push("(func $__make_fnref (param $idx i32) (result i32)");
  lines.push("  (local $ptr i32)");
  if (entries.length > 0) {
    lines.push("  (if (i32.eqz (global.get $__fn_table_inited))");
    lines.push("    (then");
    lines.push("      (global.set $__fn_table_inited (i32.const 1))");
    for (const e of entries) {
      lines.push(
        `      (table.set $__fn_table (i32.const ${e.slot}) (ref.func $${e.trampolineName}))`,
      );
    }
    lines.push("    )");
    lines.push("  )");
  }
  lines.push("  (local.set $ptr (call $alloc (i32.const 8)))");
  lines.push("  (i32.store (local.get $ptr) (local.get $idx))");
  lines.push("  (i32.store offset=4 (local.get $ptr) (i32.const 0))");
  lines.push("  (local.get $ptr)");
  lines.push(")");
  emitter.addFunctionWat(lines.join("\n"));
}

export function emitModule(ast: ASTProgram, data: ModuleMeta): MapleModule {
  resetLabels();
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

  if (ctx.mod.deferredGlobalInits.length > 0) {
    emitter.addGlobalWat("(global $__globals_inited (mut i32) (i32.const 0))");
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
            `(import "${stmt.importPath}" "${imp}" (func $${imp} (type ${typeName})))`,
          );
          emitter.addSignatureWat(emitFunctionSignature(typeName, params, results));
        } else if (info && info.kind === "global") {
          const wt = valueTypeToWasm(info.type);
          emitter.addImportWat(`(import "${stmt.importPath}" "${imp}" (global $${imp} ${wt}))`);
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

  if (data.fnSignatures.size > 0) {
    emitFnTypeDecls(data, emitter);
  }
  if (data.needsClosureRuntime) {
    emitSynthesizedImports(emitter);
    emitFnTable(data, emitter);
    emitTrampolines(data, emitter);
    emitMakeFnRefHelper(data, emitter);
  }
  emitRuntimeHelpers(emitter);

  return emitter.build();
}
