import type { ASTProgram } from "../parser/ast/ASTProgram";
import { AssignmentExpression } from "../parser/ast/expressions/AssignmentExpression";
import { CallExpression } from "../parser/ast/expressions/CallExpression";
import { CastExpression } from "../parser/ast/expressions/CastExpression";
import { FunctionLiteralExpression } from "../parser/ast/expressions/FunctionLiteralExpression";
import { Identifier } from "../parser/ast/expressions/Identifier";
import { IndexExpression } from "../parser/ast/expressions/IndexExpression";
import { InfixExpression } from "../parser/ast/expressions/InfixExpression";
import { PostfixExpression } from "../parser/ast/expressions/PostfixExpression";
import { PrefixExpression } from "../parser/ast/expressions/PrefixExpression";
import { StructLiteralExpression } from "../parser/ast/expressions/StructLiteralExpression";
import { BlockStatement } from "../parser/ast/statements/BlockStatement";
import { DeferStatement } from "../parser/ast/statements/DeferStatement";
import { ExpressionStatement } from "../parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../parser/ast/statements/ForStatement";
import { FunctionStatement } from "../parser/ast/statements/FunctionStatement";
import { IfStatement } from "../parser/ast/statements/IfStatement";
import { ImportStatement } from "../parser/ast/statements/ImportStatement";
import { LetStatement } from "../parser/ast/statements/LetStatement";
import { ReturnStatement } from "../parser/ast/statements/ReturnStatement";
import { StructStatement } from "../parser/ast/statements/StructStatement";
import { SwitchStatement } from "../parser/ast/statements/SwitchStatement";
import { TuplePattern } from "../parser/ast/statements/TuplePattern";
import { WhileStatement } from "../parser/ast/statements/WhileStatement";
import type { ASTExpression, ASTStatement } from "../parser/ast/types/ast.type";
import { extractGlobalData } from "./data-extraction";
import { createStructData, type ModuleMeta } from "./metadata";
import { canonicalFnType, isFnType, parseFnType, valueTypeToWasm } from "./types";

function generateFunctionSignature(fn: FunctionStatement): string {
  const params = fn.fnExpr.params
    .map((parameter) => signatureChar(valueTypeToWasm(parameter.type)))
    .join("");
  const results = fn.fnExpr.returnTypes
    .map((result) => signatureChar(valueTypeToWasm(result)))
    .join("");
  return `${params || "v"}_${results || "v"}`;
}

function signatureChar(type: "i32" | "i64" | "f32" | "f64"): string {
  if (type === "i32") return "i";
  if (type === "i64") return "I";
  if (type === "f32") return "f";
  return "F";
}

export function extractModuleMeta(
  program: ASTProgram,
  deferArrayElementErrors = false,
): ModuleMeta {
  const meta: ModuleMeta = {
    name: program.name,
    globals: {},
    functions: {},
    imports: {},
    exports: {},
    structs: {},
    deferredGlobalInits: [],
    fnTable: new Map(),
    fnSignatures: new Map(),
    hasFnTypedSurface: false,
    needsFnrefCreation: false,
  };

  for (const stmt of program.statements) {
    if (stmt instanceof StructStatement) {
      const data = createStructData(stmt.name, stmt.members, stmt.exported);
      meta.structs[stmt.name] = data;
      if (stmt.exported) meta.exports[stmt.name] = { kind: "struct", meta: data };
    }
  }

  if (!meta.structs.string) {
    meta.structs.string = createStructData("string", {
      len: { name: "len", type: "i32" },
      data: { name: "data", type: "i32" },
    });
  }

  for (const stmt of program.statements) {
    if (!(stmt instanceof FunctionStatement) || !stmt.name) continue;
    const signature = generateFunctionSignature(stmt);
    meta.functions[stmt.name] = {
      name: stmt.name,
      exported: stmt.exported,
      results: stmt.fnExpr.returnTypes.map(valueTypeToWasm),
      mapleResults: stmt.fnExpr.returnTypes,
      params: stmt.fnExpr.params.map(({ identifier, type }) => ({
        name: identifier.tokenLiteral(),
        type,
      })),
      signature,
    };
    if (stmt.exported) meta.exports[stmt.name] = { kind: "func", signature };
  }

  for (const stmt of program.statements) {
    if (stmt instanceof ImportStatement) {
      for (const imp of stmt.imported) {
        if (meta.imports[imp]) throw new Error(`duplicate import name "${imp}"`);
        meta.imports[imp] = {
          module: stmt.importPath,
          name: imp,
          resolved: false,
        };
      }
    }
  }

  for (const stmt of program.statements) {
    if (!(stmt instanceof LetStatement) || stmt.pattern instanceof TuplePattern) continue;
    const name = stmt.identifier.tokenLiteral();
    meta.globals[name] = { name, type: stmt.typeAnnotation, scope: "global" };
    if (stmt.exported) meta.exports[name] = { kind: "global", type: stmt.typeAnnotation };
  }

  for (const stmt of program.statements) {
    extractGlobalData(stmt, meta, false, deferArrayElementErrors);
  }

  return meta;
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
    mod.hasFnTypedSurface = true;
  }

  // Register a named function into the fn-table for indirect call support.
  // Skipped if `name` is shadowed by a local variable in the current scope.
  function registerFnRef(name: string, scope: Set<string>, importedFnValue = false): void {
    if (scope.has(name)) return;
    if (mod.fnTable.has(name)) return;
    const fnMeta = mod.functions[name];
    if (!fnMeta) {
      if (importedFnValue && mod.imports[name]) {
        mod.hasFnTypedSurface = true;
        mod.needsFnrefCreation = true;
      }
      return;
    }

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

    mod.hasFnTypedSurface = true;
    mod.needsFnrefCreation = true;
  }

  function walkExpr(expr: ASTExpression, scope: Set<string>, importedFnValue = false): void {
    if (expr instanceof Identifier) {
      registerFnRef(expr.tokenLiteral(), scope, importedFnValue);
      return;
    }
    if (expr instanceof CallExpression) {
      const params = mod.functions[expr.func]?.params;
      for (let index = 0; index < expr.args.length; index += 1) {
        const parameterType = params?.[index]?.type;
        walkExpr(expr.args[index]!, scope, parameterType ? isFnType(parameterType) : false);
      }
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
      const definition = mod.structs[expr.name];
      for (const [name, value] of Object.entries(expr.members)) {
        walkExpr(value, scope, isFnType(definition?.members[name]?.type ?? ""));
      }
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
      registerFnTypeSig(stmt.typeAnnotation);
      if (stmt.expression) walkExpr(stmt.expression, scope, isFnType(stmt.typeAnnotation));
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
    if (stmt instanceof DeferStatement) {
      walkExpr(stmt.call, scope);
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
    if (stmt instanceof StructStatement) {
      for (const member of Object.values(stmt.members)) registerFnTypeSig(member.type);
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
}
