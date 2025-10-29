import { BooleanLiteralExpression } from "../../../parser/ast/expressions/BooleanLiteralExpression.js";
import { FloatLiteralExpression } from "../../../parser/ast/expressions/FloatLiteralExpression.js";
import { IntegerLiteralExpression } from "../../../parser/ast/expressions/IntegerLiteral.js";
import { StringLiteralExpression } from "../../../parser/ast/expressions/StringLiteral.js";
import { StructLiteralExpression } from "../../../parser/ast/expressions/StructLiteralExpression.js";
import { LetStatement } from "../../../parser/ast/statements/LetStatement.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { asExpr } from "../emitter.utils.js";
import { emitSet } from "../expression/core.js";

export function emitLetStatement(stmt: LetStatement, emitter: ModuleEmitter) {
  if (stmt.expression instanceof StructLiteralExpression) {
    for (const [field, data] of Object.entries(stmt.expression.members)) {
      const isNumber =
        data instanceof IntegerLiteralExpression ||
        data instanceof IntegerLiteralExpression;
      const isString = data instanceof StringLiteralExpression;
      const isBool = data instanceof BooleanLiteralExpression;

      if (!isString && !isNumber && !isBool) {
        continue; // @TODO: Nested structs
      }
      // convert bool to 1/0, otherwise extract .value (number | string),
      // default to blank string for now
      const val = isBool
        ? data.value
          ? 1
          : 0
        : isNumber
        ? data.value
        : isString
        ? data.value
        : "";
      const name = `${stmt.identifier}_${field}`;
      const rhs = asExpr(val);
      emitter.writer.line(emitSet(name, rhs, emitter));
    }
    return;
  }
  emitter.writer.line(
    emitSet(stmt.identifier.tokenLiteral(), stmt.expression!, emitter)
  );
}
