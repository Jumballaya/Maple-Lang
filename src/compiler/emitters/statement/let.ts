import { StructLiteralExpression } from "../../../parser/ast/expressions/StructLiteralExpression.js";
import { LetStatement } from "../../../parser/ast/statements/LetStatement.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { asExpr } from "../emitter.utils.js";
import { emitSet } from "../expression/core.js";

export function emitLetStatement(stmt: LetStatement, emitter: ModuleEmitter) {
  if (stmt.expression instanceof StructLiteralExpression) {
    for (const [field, data] of Object.entries(stmt.expression.table)) {
      if (!(typeof data === "string") || !(typeof data === "number")) {
        continue; // @TODO: Nested structs
      }
      const name = `${stmt.identifier}_${field}`;
      const isNumber = typeof data === "number";
      const rhs = isNumber ? asExpr(data) : asExpr(data);
      emitter.writer.line(emitSet(name, rhs, emitter));
    }
    return;
  }
  emitter.writer.line(
    emitSet(stmt.identifier.tokenLiteral(), stmt.expression!, emitter)
  );
}
