import { ASTProgram } from "../parser/ast/ASTProgram";
import { ArrayLiteralExpression } from "../parser/ast/expressions/ArrayLiteralExpression";
import { AssignmentExpression } from "../parser/ast/expressions/AssignmentExpression";
import { CallExpression } from "../parser/ast/expressions/CallExpression";
import { CastExpression } from "../parser/ast/expressions/CastExpression";
import { FunctionLiteralExpression } from "../parser/ast/expressions/FunctionLiteralExpression";
import { Identifier } from "../parser/ast/expressions/Identifier";
import { IndexExpression } from "../parser/ast/expressions/IndexExpression";
import { InfixExpression } from "../parser/ast/expressions/InfixExpression";
import { MemberExpression } from "../parser/ast/expressions/MemberExpression";
import { PointerMemberExpression } from "../parser/ast/expressions/PointerMemberExpression";
import { PostfixExpression } from "../parser/ast/expressions/PostfixExpression";
import { PrefixExpression } from "../parser/ast/expressions/PrefixExpression";
import { StructLiteralExpression } from "../parser/ast/expressions/StructLiteralExpression";
import { BlockStatement } from "../parser/ast/statements/BlockStatement";
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
import { getIntrinsic } from "./intrinsics";
import type { MergedProgram } from "./merge-model";
import type { DeferredGlobalInit, ModuleMeta, StructData } from "./metadata";
import type { ModuleRecord } from "./module-graph";
import { canonicalFnType, parseFnType } from "./types";

type Scope = Set<string>[];

function clone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Uint8Array) return value.slice() as T;
  if (Array.isArray(value)) return value.map((entry) => clone(entry)) as T;
  if (value instanceof Map) {
    return new Map([...value].map(([key, entry]) => [clone(key), clone(entry)])) as T;
  }
  const result = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    result[key] = clone((value as Record<string, unknown>)[key]);
  }
  return result as T;
}

function localKey(module: ModuleRecord, name: string): string {
  return `${module.manglePrefix}$$${name}`;
}

function isLocal(scopes: Scope, name: string): boolean {
  return scopes.some((scope) => scope.has(name));
}

function setIdentifier(identifier: Identifier, name: string): void {
  if (identifier.token.type === "Identifier") identifier.token.literal = name;
}

function symbolName(model: MergedProgram, module: ModuleRecord, name: string): string {
  if (getIntrinsic(name)) return name;
  const key = localKey(module, name);
  if (model.functions.has(key) || model.globals.has(key)) return key;
  return model.imports.get(key) ?? name;
}

function structName(model: MergedProgram, module: ModuleRecord, name: string): string {
  if (name === "string") return name;
  const key = localKey(module, name);
  if (model.structs.has(key)) return key;
  const imported = model.imports.get(key);
  return imported && model.structs.has(imported) ? imported : name;
}

function rewriteType(model: MergedProgram, module: ModuleRecord, type: string): string {
  if (type.startsWith("*")) return `*${rewriteType(model, module, type.slice(1))}`;
  if (type.endsWith("[]")) return `${rewriteType(model, module, type.slice(0, -2))}[]`;
  const fnType = parseFnType(type);
  if (fnType) {
    return canonicalFnType(
      fnType.params.map((entry) => rewriteType(model, module, entry)),
      fnType.results.map((entry) => rewriteType(model, module, entry)),
    );
  }
  return structName(model, module, type);
}

function rewriteAnnotations(
  expression: ASTExpression,
  model: MergedProgram,
  module: ModuleRecord,
): void {
  if (expression.resolvedType !== undefined) {
    expression.resolvedType = rewriteType(model, module, expression.resolvedType);
  }
  if (expression.resolvedResultTypes !== undefined) {
    expression.resolvedResultTypes = expression.resolvedResultTypes.map((type) =>
      rewriteType(model, module, type),
    );
  }
  if (expression.resolvedDecl) {
    const declaration = expression.resolvedDecl;
    if (declaration.kind !== "local" && declaration.kind !== "param") {
      const name = symbolName(model, module, declaration.name);
      declaration.name = name;
      if (declaration.kind === "import") {
        if (model.functions.has(name)) declaration.kind = "function";
        else if (model.globals.has(name)) declaration.kind = "global";
      }
    }
  }
  const target = expression.resolvedCallTarget;
  if (target?.kind === "field") {
    target.structIdentity = rewriteType(model, module, target.structIdentity);
    target.fnType = rewriteType(model, module, target.fnType);
  }
}

function rewriteExpression(
  expression: ASTExpression,
  model: MergedProgram,
  module: ModuleRecord,
  scopes: Scope,
): void {
  rewriteAnnotations(expression, model, module);
  if (expression instanceof Identifier) {
    const name = expression.tokenLiteral();
    expression.typeAnnotation = rewriteType(model, module, expression.typeAnnotation);
    if (!isLocal(scopes, name)) setIdentifier(expression, symbolName(model, module, name));
    return;
  }
  if (expression instanceof CallExpression) {
    if (!isLocal(scopes, expression.func)) {
      expression.func = symbolName(model, module, expression.func);
    }
    for (const argument of expression.args) rewriteExpression(argument, model, module, scopes);
    return;
  }
  if (expression instanceof AssignmentExpression) {
    rewriteExpression(expression.left, model, module, scopes);
    if (expression.value) rewriteExpression(expression.value, model, module, scopes);
    return;
  }
  if (expression instanceof InfixExpression) {
    rewriteExpression(expression.left, model, module, scopes);
    rewriteExpression(expression.right, model, module, scopes);
    return;
  }
  if (expression instanceof IndexExpression) {
    rewriteExpression(expression.left, model, module, scopes);
    rewriteExpression(expression.index, model, module, scopes);
    return;
  }
  if (expression instanceof PrefixExpression) {
    if (expression.right) rewriteExpression(expression.right, model, module, scopes);
    return;
  }
  if (expression instanceof PostfixExpression) {
    if (expression.left) rewriteExpression(expression.left, model, module, scopes);
    return;
  }
  if (expression instanceof CastExpression) {
    expression.targetType = rewriteType(model, module, expression.targetType);
    rewriteExpression(expression.expr, model, module, scopes);
    return;
  }
  if (expression instanceof MemberExpression || expression instanceof PointerMemberExpression) {
    rewriteExpression(expression.parent, model, module, scopes);
    return;
  }
  if (expression instanceof ArrayLiteralExpression) {
    expression.memberType = rewriteType(model, module, expression.memberType);
    for (const element of expression.elements) rewriteExpression(element, model, module, scopes);
    return;
  }
  if (expression instanceof StructLiteralExpression) {
    expression.name = structName(model, module, expression.name);
    for (const member of Object.values(expression.members)) {
      rewriteExpression(member, model, module, scopes);
    }
    return;
  }
  if (expression instanceof FunctionLiteralExpression) {
    const functionScope = new Set<string>();
    for (const parameter of expression.params) {
      parameter.type = rewriteType(model, module, parameter.type);
      parameter.identifier.typeAnnotation = parameter.type;
      functionScope.add(parameter.identifier.tokenLiteral());
    }
    expression.returnTypes = expression.returnTypes.map((entry) =>
      rewriteType(model, module, entry),
    );
    rewriteBlock(expression.body, model, module, [...scopes, functionScope]);
  }
}

function bindLet(statement: LetStatement, scope: Set<string>): void {
  if (statement.pattern instanceof TuplePattern) {
    for (const name of statement.pattern.names) {
      if (name.kind === "name") scope.add(name.value);
    }
  } else {
    scope.add(statement.pattern.tokenLiteral());
  }
}

function rewriteStatement(
  statement: ASTStatement,
  model: MergedProgram,
  module: ModuleRecord,
  scopes: Scope,
): void {
  if (statement instanceof LetStatement) {
    statement.typeAnnotation = rewriteType(model, module, statement.typeAnnotation);
    delete statement.resolvedName;
    delete statement.resolvedNames;
    if (statement.expression) rewriteExpression(statement.expression, model, module, scopes);
    bindLet(statement, scopes.at(-1)!);
    return;
  }
  if (statement instanceof ReturnStatement) {
    for (const value of statement.returnValues) rewriteExpression(value, model, module, scopes);
    return;
  }
  if (statement instanceof ExpressionStatement) {
    if (statement.expression) rewriteExpression(statement.expression, model, module, scopes);
    return;
  }
  if (statement instanceof IfStatement) {
    rewriteExpression(statement.conditionExpr, model, module, scopes);
    rewriteBlock(statement.thenBlock, model, module, scopes);
    if (statement.elseBlock) rewriteBlock(statement.elseBlock, model, module, scopes);
    return;
  }
  if (statement instanceof WhileStatement) {
    rewriteExpression(statement.condExpr, model, module, scopes);
    rewriteBlock(statement.loopBody, model, module, scopes);
    return;
  }
  if (statement instanceof ForStatement) {
    const loopScopes = [...scopes, new Set<string>()];
    rewriteStatement(statement.initBlock, model, module, loopScopes);
    rewriteStatement(statement.conditionExpr, model, module, loopScopes);
    rewriteStatement(statement.updateExpr, model, module, loopScopes);
    rewriteBlock(statement.loopBody, model, module, loopScopes);
    return;
  }
  if (statement instanceof SwitchStatement) {
    rewriteExpression(statement.switchExpr, model, module, scopes);
    for (const branch of statement.cases) rewriteBlock(branch.body, model, module, scopes);
    if (statement.default) rewriteBlock(statement.default, model, module, scopes);
    return;
  }
  if (statement instanceof BlockStatement) rewriteBlock(statement, model, module, scopes);
}

function rewriteBlock(
  block: BlockStatement,
  model: MergedProgram,
  module: ModuleRecord,
  scopes: Scope,
): void {
  const blockScopes = [...scopes, new Set<string>()];
  for (const statement of block.statements) {
    rewriteStatement(statement, model, module, blockScopes);
  }
}

function mergedStructs(model: MergedProgram): Record<string, StructData> {
  return Object.fromEntries(
    [...model.structs].map(([name, struct]) => [
      name,
      {
        name,
        size: struct.size,
        exported: false,
        members: Object.fromEntries(
          Object.entries(struct.members).map(([memberName, member]) => [
            memberName,
            { ...member, type: member.resolvedType },
          ]),
        ),
      },
    ]),
  );
}

export function buildMergedAst(model: MergedProgram): ASTProgram {
  const program = new ASTProgram("statement", "merged");
  for (const moduleKey of model.moduleOrder) {
    const module = model.modules.get(moduleKey);
    if (!module) continue;
    for (const original of module.ast.statements) {
      if (original instanceof ImportStatement) continue;
      if (
        original instanceof FunctionStatement &&
        !model.reachable.functions.has(localKey(module, original.name))
      ) {
        continue;
      }
      if (
        original instanceof LetStatement &&
        !(original.pattern instanceof TuplePattern) &&
        !model.reachable.globals.has(localKey(module, original.pattern.tokenLiteral()))
      ) {
        continue;
      }
      const statement = clone(original);
      if (statement instanceof StructStatement) {
        statement.name = structName(model, module, statement.name);
        statement.exported = false;
        statement.members = Object.fromEntries(
          Object.entries(statement.members).map(([name, member]) => [
            name,
            { ...member, type: rewriteType(model, module, member.type) },
          ]),
        );
      } else if (statement instanceof FunctionStatement) {
        const sourceName = statement.name;
        statement.name = localKey(module, sourceName);
        statement.exported =
          module.key === model.entryKey && model.exports.get(sourceName) === statement.name;
        statement.receiverType = statement.receiverType
          ? rewriteType(model, module, statement.receiverType)
          : null;
        rewriteExpression(statement.fnExpr, model, module, []);
      } else if (
        statement instanceof LetStatement &&
        !(statement.pattern instanceof TuplePattern)
      ) {
        const sourceName = statement.pattern.tokenLiteral();
        statement.typeAnnotation = rewriteType(model, module, statement.typeAnnotation);
        statement.exported =
          module.key === model.entryKey &&
          model.exports.get(sourceName) === localKey(module, sourceName);
        if (statement.expression) rewriteExpression(statement.expression, model, module, []);
        setIdentifier(statement.pattern, localKey(module, sourceName));
      }
      program.statements.push(statement);
    }
  }
  return program;
}

function buildLoweringMeta(model: MergedProgram): ModuleMeta {
  const deferredGlobalInits: DeferredGlobalInit[] = model.startupInitializers.map((entry) => {
    const module = model.modules.get(entry.moduleKey)!;
    const initializer = clone(entry.initializer);
    if (initializer.kind === "global") {
      rewriteExpression(initializer.expr, model, module, []);
      initializer.type = rewriteType(model, module, initializer.type);
    }
    return initializer;
  });

  const meta: ModuleMeta = {
    name: "merged",
    globals: Object.fromEntries(
      [...model.globals]
        .filter(([name]) => model.reachable.globals.has(name))
        .map(([name, global]) => [name, { ...global.meta, name, type: global.resolvedType }]),
    ),
    functions: Object.fromEntries(
      [...model.functions]
        .filter(([name]) => model.reachable.functions.has(name))
        .map(([name, fn]) => [
          name,
          {
            ...fn.meta,
            name,
            params: fn.resolvedParams,
            mapleResults: fn.resolvedResults,
            exported: [...model.exports.values()].includes(name),
          },
        ]),
    ),
    imports: {},
    exports: {},
    structs: mergedStructs(model),
    deferredGlobalInits,
    fnTable: new Map(
      model.fnTable.entries.map((entry) => [
        entry.functionName,
        {
          slot: entry.slot,
          trampolineName: entry.trampolineName,
          originalName: entry.functionName,
          signatureKey: entry.signatureKey,
          isLambda: entry.isLambda,
        },
      ]),
    ),
    fnSignatures: new Map(model.fnTable.signatures),
    hasFnTypedSurface: model.fnTable.hasFnTypedSurface,
    needsFnrefCreation: model.fnTable.needsFnrefCreation,
  };
  return meta;
}

function resolvedAllocator(model: MergedProgram): string | undefined {
  const allocator = [...model.imports].find(
    ([local, target]) => local.endsWith("$$alloc") && target.endsWith("$$malloc"),
  )?.[1];
  return allocator && model.reachable.functions.has(allocator) ? allocator : undefined;
}

export type MergedLoweringInput = {
  ast: ASTProgram;
  meta: ModuleMeta;
  exportMap: Map<string, string>;
  allocator?: string;
};

export function buildMergedLoweringInput(model: MergedProgram): MergedLoweringInput {
  const input: MergedLoweringInput = {
    ast: buildMergedAst(model),
    meta: buildLoweringMeta(model),
    exportMap: new Map(model.exports),
  };
  const allocator = resolvedAllocator(model);
  if (allocator !== undefined) input.allocator = allocator;
  return input;
}
