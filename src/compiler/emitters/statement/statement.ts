import { Identifier } from "../../../parser/ast/expressions/Identifier";
import { PostfixExpression } from "../../../parser/ast/expressions/PostfixExpression";
import { BlockStatement } from "../../../parser/ast/statements/BlockStatement";
import { BreakStatement } from "../../../parser/ast/statements/BreakStatement";
import { ContinueStatement } from "../../../parser/ast/statements/ContinueStatement";
import { ExpressionStatement } from "../../../parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../../../parser/ast/statements/ForStatement";
import { IfStatement } from "../../../parser/ast/statements/IfStatement";
import { LetStatement } from "../../../parser/ast/statements/LetStatement";
import { ReturnStatement } from "../../../parser/ast/statements/ReturnStatement";
import { SwitchStatement } from "../../../parser/ast/statements/SwitchStatement";
import { WhileStatement } from "../../../parser/ast/statements/WhileStatement";
import type { ASTStatement } from "../../../parser/ast/types/ast.type";
import { MapleError } from "../../errors";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { emitGet } from "../expression/core";
import { emitExpression } from "../expression/expression";
import { emitBreakStatement } from "./break";
import { emitContinueStatement } from "./continue";
import { emitForStatement } from "./for";
import { emitIfStatement } from "./if";
import { emitLetStatement } from "./let";
import { emitSwitchStatement } from "./switch";
import { emitWhileStatement } from "./while";

function emitPostfixVoid(expr: PostfixExpression, emitter: ModuleEmitter): string {
  if (!(expr.left instanceof Identifier)) {
    const t = expr.token;
    throw new MapleError(
      "[statement emitter] postfix statement only supports identifiers",
      t.line,
      t.col,
    );
  }
  const name = expr.left.tokenLiteral();
  const v = emitter.getVar(name);
  if (!v) {
    const t = expr.left.token;
    throw new MapleError(`variable not found: "${name}"`, t.line, t.col);
  }
  const delta = expr.operator === "++" ? 1 : -1;
  const updated = `(i32.add ${emitGet(name, emitter)} (i32.const ${delta}))`;
  const setOp = v.scope === "global" ? "global.set" : "local.set";
  return `(${setOp} $${name} ${updated})`;
}

export function emitStatement(stmt: ASTStatement, emitter: ModuleEmitter): void {
  if (stmt instanceof BlockStatement) {
    for (const s of stmt.statements) {
      emitStatement(s, emitter);
    }
    return;
  }

  if (stmt instanceof ReturnStatement) {
    if (stmt.returnValue) {
      emitter.writer.line(`(return ${emitExpression(stmt.returnValue, emitter)})`);
      return;
    }
    emitter.writer.line(`(return)`);
    return;
  }
  if (stmt instanceof LetStatement) {
    emitLetStatement(stmt, emitter);
    return;
  }
  if (stmt instanceof IfStatement) {
    emitIfStatement(stmt, emitter);
    return;
  }
  if (stmt instanceof ExpressionStatement) {
    if (stmt.expression instanceof PostfixExpression) {
      // Void context: emit only the mutation; the old value is not needed and must
      // not be left on the WASM stack (which would corrupt subsequent instructions).
      emitter.writer.line(emitPostfixVoid(stmt.expression, emitter));
    } else {
      emitter.writer.line(emitExpression(stmt.expression!, emitter));
    }
    return;
  }
  if (stmt instanceof WhileStatement) {
    emitWhileStatement(stmt, emitter);
    return;
  }
  if (stmt instanceof ForStatement) {
    emitForStatement(stmt, emitter);
    return;
  }
  if (stmt instanceof BreakStatement) {
    emitBreakStatement(stmt, emitter);
    return;
  }
  if (stmt instanceof ContinueStatement) {
    emitContinueStatement(stmt, emitter);
    return;
  }
  if (stmt instanceof SwitchStatement) {
    emitSwitchStatement(stmt, emitter);
    return;
  }

  const t = stmt.token;
  throw new MapleError(
    `[statement emitter] statement type: ${stmt.tokenLiteral()} not implemented`,
    t.line,
    t.col,
  );
}
