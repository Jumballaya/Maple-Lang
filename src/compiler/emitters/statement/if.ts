import { IfStatement } from "../../../parser/ast/statements/IfStatement.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { extractNeedsReturn } from "../analysis/flow.js";
import { emitExpression } from "../expression/expression.js";
import { emitStatement } from "./statement.js";

// if both branches return, than the if needs to be marked with a result
// e.g. (if (result i32)
export function emitIfStatement(stmt: IfStatement, emitter: ModuleEmitter) {
  emitter.writer.append("(if");

  const needsReturn = extractNeedsReturn(stmt);
  if (needsReturn) {
    emitter.writer.append(` (result i32)`);
  }
  emitter.writer.newLine();

  // condition
  emitter.writer.tabIn();
  emitter.writer.line(emitExpression(stmt.condition, emitter));

  // then
  emitter.writer.open("(then ");
  emitStatement(stmt.thenBlock, emitter);
  emitter.writer.close(")");
  emitter.writer.newLine();

  // else
  if (stmt.elseBlock) {
    emitter.writer.open("(else ");
    emitStatement(stmt.elseBlock, emitter);
    emitter.writer.close(")");
    emitter.writer.newLine();
  }

  emitter.writer.close(")");
}
