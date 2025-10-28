import { BlockStatement } from "../../../parser/ast/statements/BlockStatement.js";
import { ExpressionStatement } from "../../../parser/ast/statements/ExpressionStatement.js";
import { ForStatement } from "../../../parser/ast/statements/ForStatement.js";
import { IfStatement } from "../../../parser/ast/statements/IfStatement.js";
import { LetStatement } from "../../../parser/ast/statements/LetStatement.js";
import { ReturnStatement } from "../../../parser/ast/statements/ReturnStatement.js";
import { WhileStatement } from "../../../parser/ast/statements/WhileStatement.js";
import { ASTStatement } from "../../../parser/ast/types/ast.type.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { emitExpression } from "../expression/expression.js";
import { emitForStatement } from "./for.js";
import { emitIfStatement } from "./if.js";
import { emitLetStatement } from "./let.js";
import { emitWhileStatement } from "./while.js";

export function emitStatement(
  stmt: ASTStatement,
  emitter: ModuleEmitter
): void {
  if (stmt instanceof BlockStatement) {
    for (const s of stmt.statements) {
      emitStatement(s, emitter);
    }
    return;
  }

  if (stmt instanceof ReturnStatement) {
    if (stmt.returnValue) {
      emitter.writer.line(
        `(return ${emitExpression(stmt.returnValue, emitter)})`
      );
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

  throw new Error(
    `[statement emitter] statement type: ${stmt.type} not implemented`
  );
}
