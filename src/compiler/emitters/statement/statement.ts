import { BlockStatement } from "../../../parser/ast/statements/BlockStatement.js";
import { BreakStatement } from "../../../parser/ast/statements/BreakStatement.js";
import { ContinueStatement } from "../../../parser/ast/statements/ContinueStatement.js";
import { ExpressionStatement } from "../../../parser/ast/statements/ExpressionStatement.js";
import { ForStatement } from "../../../parser/ast/statements/ForStatement.js";
import { IfStatement } from "../../../parser/ast/statements/IfStatement.js";
import { LetStatement } from "../../../parser/ast/statements/LetStatement.js";
import { ReturnStatement } from "../../../parser/ast/statements/ReturnStatement.js";
import { SwitchStatement } from "../../../parser/ast/statements/SwitchStatement.js";
import { WhileStatement } from "../../../parser/ast/statements/WhileStatement.js";
import type { ASTStatement } from "../../../parser/ast/types/ast.type.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { emitExpression } from "../expression/expression.js";
import { emitBreakStatement } from "./break.js";
import { emitContinueStatement } from "./continue.js";
import { emitForStatement } from "./for.js";
import { emitIfStatement } from "./if.js";
import { emitLetStatement } from "./let.js";
import { emitSwitchStatement } from "./switch.js";
import { emitWhileStatement } from "./while.js";

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
