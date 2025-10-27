import { LetStatement } from "../../../parser/ast/statements/LetStatement.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { asExpr } from "../emitter.utils.js";
import { emitSet } from "../expression/core.js";

export function emitLetStatement(stmt: LetStatement, emitter: ModuleEmitter) {
  if (stmt.expression.type === "struct_literal") {
    for (const [field, data] of Object.entries(stmt.expression.values)) {
      const name = `${stmt.identifier}_${field}`;
      const isNumber = typeof data === "number";
      const rhs = isNumber ? asExpr(data) : asExpr(data);
      emitter.writer.line(emitSet(name, rhs, emitter));
    }
    return;
  }
  emitter.writer.line(emitSet(stmt.identifier, stmt.expression, emitter));
}
