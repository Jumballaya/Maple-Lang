import { ForStatement } from "../../../parser/ast/statements/ForStatement.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { makeLabel } from "../emitter.utils.js";
import { emitExpression } from "../expression/expression.js";
import { emitStatement } from "./statement.js";

export function emitForStatement(stmt: ForStatement, emitter: ModuleEmitter) {
  const br = makeLabel("break");
  const lp = makeLabel("loop");

  // break
  emitter.writer.open(`(block ${br}`);

  // loop
  emitter.writer.open(`(loop ${lp}`);

  // break condition
  const cond = emitExpression(stmt.conditionExpr.expression!, emitter);
  const t = emitter.getExprType(stmt.conditionExpr.expression!);
  const asI32 =
    t === "bool"
      ? cond
      : t === "i32"
      ? `(i32.ne ${cond} (i32.const 0))`
      : `(f32.ne ${cond} (f32.const 0))`;
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
}
