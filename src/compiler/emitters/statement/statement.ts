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
import type { ModuleEmitter } from "../../ModuleEmitter";
import { emitExpression } from "../expression/expression";
import { emitBreakStatement } from "./break";
import { emitContinueStatement } from "./continue";
import { emitForStatement } from "./for";
import { emitIfStatement } from "./if";
import { emitLetStatement } from "./let";
import { emitSwitchStatement } from "./switch";
import { emitWhileStatement } from "./while";

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
    emitter.writer.line(emitExpression(stmt.expression!, emitter));
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

  throw new Error(`[statement emitter] statement type: ${stmt.tokenLiteral()} not implemented`);
}
