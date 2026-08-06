import type { ASTProgram } from "../parser/ast/ASTProgram";
import { ArrayLiteralExpression } from "../parser/ast/expressions/ArrayLiteralExpression";
import { AssignmentExpression } from "../parser/ast/expressions/AssignmentExpression";
import { BooleanLiteralExpression } from "../parser/ast/expressions/BooleanLiteralExpression";
import { CallExpression } from "../parser/ast/expressions/CallExpression";
import { CastExpression } from "../parser/ast/expressions/CastExpression";
import { CharLiteralExpression } from "../parser/ast/expressions/CharLiteralExpression";
import { FloatLiteralExpression } from "../parser/ast/expressions/FloatLiteralExpression";
import { IndexExpression } from "../parser/ast/expressions/IndexExpression";
import { InfixExpression } from "../parser/ast/expressions/InfixExpression";
import { IntegerLiteralExpression } from "../parser/ast/expressions/IntegerLiteral";
import { MemberExpression } from "../parser/ast/expressions/MemberExpression";
import { PointerMemberExpression } from "../parser/ast/expressions/PointerMemberExpression";
import { PostfixExpression } from "../parser/ast/expressions/PostfixExpression";
import { PrefixExpression } from "../parser/ast/expressions/PrefixExpression";
import { StringLiteralExpression } from "../parser/ast/expressions/StringLiteral";
import { StructLiteralExpression } from "../parser/ast/expressions/StructLiteralExpression";
import { BlockStatement } from "../parser/ast/statements/BlockStatement";
import { DeferStatement } from "../parser/ast/statements/DeferStatement";
import { ExpressionStatement } from "../parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../parser/ast/statements/ForStatement";
import { FunctionStatement } from "../parser/ast/statements/FunctionStatement";
import { IfStatement } from "../parser/ast/statements/IfStatement";
import { LetStatement } from "../parser/ast/statements/LetStatement";
import { ReturnStatement } from "../parser/ast/statements/ReturnStatement";
import { SwitchStatement } from "../parser/ast/statements/SwitchStatement";
import { TuplePattern } from "../parser/ast/statements/TuplePattern";
import { WhileStatement } from "../parser/ast/statements/WhileStatement";
import type { ASTExpression, ASTStatement } from "../parser/ast/types/ast.type";
import type { ModuleMeta, StructData } from "./metadata";

function nextInitializerId(meta: ModuleMeta, owner: string): string {
  const ordinal = meta.deferredGlobalInits.filter((entry) => entry.owner === owner).length;
  return `${owner}:${ordinal}`;
}

function deferMemoryInitializers(
  expression: StructLiteralExpression,
  owner: string,
  struct: StructData,
  meta: ModuleMeta,
): void {
  for (const member of Object.values(struct.members).sort(
    (left, right) => left.offset - right.offset,
  )) {
    const value = expression.members[member.name];
    if (!value || isDirectStructField(value)) continue;
    meta.deferredGlobalInits.push({
      kind: "memory",
      id: nextInitializerId(meta, owner),
      owner,
    });
  }
}

export function extractGlobalData(
  statement: ASTStatement,
  meta: ModuleMeta,
  insideFunction = false,
  deferArrayElementErrors = false,
): void {
  if (statement instanceof BlockStatement) {
    for (const child of statement.statements) {
      extractGlobalData(child, meta, insideFunction, deferArrayElementErrors);
    }
    return;
  }
  if (statement instanceof FunctionStatement) {
    extractGlobalData(statement.fnExpr.body, meta, true, deferArrayElementErrors);
    return;
  }
  if (statement instanceof LetStatement) {
    if (statement.expression) {
      scanExpression(statement.expression, deferArrayElementErrors);
    }
    if (
      !insideFunction &&
      !(statement.pattern instanceof TuplePattern) &&
      statement.expression instanceof ArrayLiteralExpression &&
      hasDynamicArrayElements(statement.expression)
    ) {
      const owner = statement.identifier.tokenLiteral();
      meta.deferredGlobalInits.push({
        kind: "array-elements",
        id: nextInitializerId(meta, owner),
        owner,
        name: owner,
      });
    }
    if (
      !insideFunction &&
      !(statement.pattern instanceof TuplePattern) &&
      statement.expression instanceof StructLiteralExpression
    ) {
      const owner = statement.identifier.tokenLiteral();
      const struct = meta.structs[statement.expression.name];
      if (struct) deferMemoryInitializers(statement.expression, owner, struct, meta);
    }
    if (
      !insideFunction &&
      !(statement.pattern instanceof TuplePattern) &&
      statement.expression &&
      !isConstInitializer(statement.expression)
    ) {
      const owner = statement.identifier.tokenLiteral();
      meta.deferredGlobalInits.push({
        kind: "global",
        id: nextInitializerId(meta, owner),
        owner,
        name: owner,
        type: statement.typeAnnotation,
        expr: statement.expression,
      });
    }
    return;
  }
  if (statement instanceof ExpressionStatement) {
    if (statement.expression) scanExpression(statement.expression, deferArrayElementErrors);
    return;
  }
  if (statement instanceof ReturnStatement) {
    for (const value of statement.returnValues) scanExpression(value, deferArrayElementErrors);
    return;
  }
  if (statement instanceof IfStatement) {
    scanExpression(statement.conditionExpr, deferArrayElementErrors);
    extractGlobalData(statement.thenBlock, meta, insideFunction, deferArrayElementErrors);
    if (statement.elseBlock) {
      extractGlobalData(statement.elseBlock, meta, insideFunction, deferArrayElementErrors);
    }
    return;
  }
  if (statement instanceof DeferStatement) {
    scanExpression(statement.call, deferArrayElementErrors);
    return;
  }
  if (statement instanceof WhileStatement) {
    scanExpression(statement.condExpr, deferArrayElementErrors);
    extractGlobalData(statement.loopBody, meta, insideFunction, deferArrayElementErrors);
    return;
  }
  if (statement instanceof ForStatement) {
    extractGlobalData(statement.initBlock, meta, insideFunction, deferArrayElementErrors);
    if (statement.conditionExpr.expression) {
      scanExpression(statement.conditionExpr.expression, deferArrayElementErrors);
    }
    if (statement.updateExpr.expression) {
      scanExpression(statement.updateExpr.expression, deferArrayElementErrors);
    }
    extractGlobalData(statement.loopBody, meta, insideFunction, deferArrayElementErrors);
    return;
  }
  if (statement instanceof SwitchStatement) {
    scanExpression(statement.switchExpr, deferArrayElementErrors);
    for (const branch of statement.cases) {
      extractGlobalData(branch.body, meta, insideFunction, deferArrayElementErrors);
    }
    if (statement.default) {
      extractGlobalData(statement.default, meta, insideFunction, deferArrayElementErrors);
    }
  }
}

export function extractLinkedStructGlobals(program: ASTProgram, meta: ModuleMeta): void {
  for (const statement of program.statements) {
    if (!(statement instanceof LetStatement)) continue;
    if (!(statement.expression instanceof StructLiteralExpression)) continue;
    if (meta.structs[statement.expression.name]) continue;
    const struct = meta.imports[statement.expression.name]?.structMeta;
    if (!struct) continue;
    deferMemoryInitializers(
      statement.expression,
      statement.identifier.tokenLiteral(),
      struct,
      meta,
    );
  }
}

export function isConstInitializer(expression: ASTExpression): boolean {
  if (
    expression instanceof IntegerLiteralExpression ||
    expression instanceof FloatLiteralExpression ||
    expression instanceof BooleanLiteralExpression ||
    expression instanceof CharLiteralExpression ||
    expression instanceof StringLiteralExpression ||
    expression instanceof ArrayLiteralExpression ||
    expression instanceof StructLiteralExpression
  ) {
    return true;
  }
  return (
    expression instanceof PrefixExpression &&
    expression.operator === "-" &&
    (expression.right instanceof IntegerLiteralExpression ||
      expression.right instanceof FloatLiteralExpression)
  );
}

function isDirectStructField(expression: ASTExpression): boolean {
  return (
    expression instanceof IntegerLiteralExpression ||
    expression instanceof FloatLiteralExpression ||
    expression instanceof BooleanLiteralExpression ||
    expression instanceof StringLiteralExpression
  );
}

function scanExpression(expression: ASTExpression, deferArrayElementErrors: boolean): void {
  if (expression instanceof ArrayLiteralExpression) {
    for (const element of expression.elements) scanExpression(element, deferArrayElementErrors);
    return;
  }
  if (expression instanceof StructLiteralExpression) {
    for (const value of Object.values(expression.members)) {
      scanExpression(value, deferArrayElementErrors);
    }
    return;
  }
  if (expression instanceof AssignmentExpression) {
    scanExpression(expression.left, deferArrayElementErrors);
    if (expression.value) scanExpression(expression.value, deferArrayElementErrors);
    return;
  }
  if (expression instanceof CallExpression) {
    for (const argument of expression.args) scanExpression(argument, deferArrayElementErrors);
    return;
  }
  if (expression instanceof InfixExpression) {
    scanExpression(expression.left, deferArrayElementErrors);
    scanExpression(expression.right, deferArrayElementErrors);
    return;
  }
  if (expression instanceof IndexExpression) {
    scanExpression(expression.left, deferArrayElementErrors);
    scanExpression(expression.index, deferArrayElementErrors);
    return;
  }
  if (expression instanceof MemberExpression || expression instanceof PointerMemberExpression) {
    scanExpression(expression.parent, deferArrayElementErrors);
    return;
  }
  if (expression instanceof PrefixExpression) {
    if (expression.right) scanExpression(expression.right, deferArrayElementErrors);
    return;
  }
  if (expression instanceof PostfixExpression) {
    if (expression.left) scanExpression(expression.left, deferArrayElementErrors);
    return;
  }
  if (expression instanceof CastExpression) {
    scanExpression(expression.expr, deferArrayElementErrors);
  }
}

export function isStaticArrayElement(expression: ASTExpression): boolean {
  return (
    expression instanceof IntegerLiteralExpression ||
    expression instanceof FloatLiteralExpression ||
    expression instanceof BooleanLiteralExpression ||
    expression instanceof StringLiteralExpression
  );
}

export function hasDynamicArrayElements(expression: ArrayLiteralExpression): boolean {
  return expression.elements.some((element) => !isStaticArrayElement(element));
}
