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
  switch (stmt.type) {
    case "block": {
      for (const s of stmt.body) {
        emitStatement(s, emitter);
      }
      break;
    }
    case "return": {
      emitter.writer.line(
        `(return ${emitExpression(stmt.expression, emitter)})`
      );
      break;
    }
    case "let": {
      emitLetStatement(stmt, emitter);
      break;
    }
    case "if": {
      emitIfStatement(stmt, emitter);
      break;
    }
    case "expression": {
      emitter.writer.line(emitExpression(stmt.expression, emitter));
      break;
    }
    case "while": {
      emitWhileStatement(stmt, emitter);
      break;
    }
    case "for": {
      emitForStatement(stmt, emitter);
      break;
    }
    default: {
      throw new Error(
        `[statement emitter] statement type: ${stmt.type} not implemented`
      );
    }
  }
}
