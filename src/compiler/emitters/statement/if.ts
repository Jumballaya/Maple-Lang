import type { IfStatement } from "../../../parser/ast/statements/IfStatement";
import { MapleError } from "../../errors";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { extractIfResultType, extractNeedsReturn } from "../analysis/flow";
import { valueTypeToWasm } from "../emit.types";
import { emitExpression } from "../expression/expression";
import { emitStatement } from "./statement";

// if both branches return, the if needs to be marked with the actual result type
export function emitIfStatement(stmt: IfStatement, emitter: ModuleEmitter) {
  emitter.writer.append("(if");

  const needsReturn = extractNeedsReturn(stmt);
  if (needsReturn) {
    const resultType = extractIfResultType(stmt, emitter);
    if (resultType !== null) {
      emitter.writer.append(` (result ${resultType})`);
    }
  }
  emitter.writer.newLine();

  // condition
  const cond = emitExpression(stmt.conditionExpr, emitter);
  const t = emitter.getExprType(stmt.conditionExpr);
  let asI32: string;
  if (t === "bool") {
    asI32 = cond;
  } else if (t === "void") {
    throw new MapleError(
      `if condition must be a numeric or boolean expression, got 'void'`,
      stmt.token.line,
      stmt.token.col,
    );
  } else {
    const w = valueTypeToWasm(t);
    if (w === "i32") {
      asI32 = `(i32.ne ${cond} (i32.const 0))`;
    } else if (w === "i64") {
      asI32 = `(i64.ne ${cond} (i64.const 0))`;
    } else if (w === "f32") {
      asI32 = `(f32.ne ${cond} (f32.const 0))`;
    } else if (w === "f64") {
      asI32 = `(f64.ne ${cond} (f64.const 0))`;
    } else {
      throw new MapleError(
        `if condition must be a numeric or boolean expression, got '${t}'`,
        stmt.token.line,
        stmt.token.col,
      );
    }
  }
  emitter.writer.tabIn();
  emitter.writer.line(asI32);

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
