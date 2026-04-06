import type { ForStatement } from "../../../parser/ast/statements/ForStatement";
import { MapleError } from "../../errors";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { valueTypeToWasm } from "../emit.types";
import { emitExpression } from "../expression/expression";
import { emitLetStatement } from "./let";
import { emitStatement } from "./statement";

export function emitForStatement(stmt: ForStatement, emitter: ModuleEmitter) {
  // Emit the initializer before entering the loop so non-zero inits are applied
  emitLetStatement(stmt.initBlock, emitter);

  const br = emitter.makeLabel("break");
  const lp = emitter.makeLabel("loop");

  // break
  emitter.writer.open(`(block ${br}`);

  // loop
  emitter.writer.open(`(loop ${lp}`);

  // break condition
  const condExpr = stmt.conditionExpr.expression!;
  const cond = emitExpression(condExpr, emitter);
  const t = emitter.getExprType(condExpr);
  let asI32: string;
  if (t === "bool") {
    asI32 = cond;
  } else if (t === "void") {
    throw new MapleError(
      `for loop condition must be a numeric or boolean expression, got 'void'`,
      stmt.conditionExpr.token.line,
      stmt.conditionExpr.token.col,
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
        `for loop condition must be a numeric or boolean expression, got '${t}'`,
        stmt.conditionExpr.token.line,
        stmt.conditionExpr.token.col,
      );
    }
  }
  emitter.writer.line(`(br_if ${br} (i32.eqz ${asI32}))`);

  // body
  emitStatement(stmt.loopBody, emitter);

  // update function
  emitter.writer.line(emitExpression(stmt.updateExpr.expression!, emitter));

  // loop to top
  emitter.writer.line(`(br ${lp})`);

  // end loop
  emitter.writer.close(")");

  // end break
  emitter.writer.close(")");

  emitter.destroyLabel("break", br);
  emitter.destroyLabel("loop", lp);
}
