import { WhileStatement } from "../../../parser/ast/statements/WhileStatement.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { makeLabel } from "../emitter.utils.js";
import { emitExpression } from "../expression/expression.js";
import { emitStatement } from "./statement.js";

export function emitWhileStatement(
  stmt: WhileStatement,
  emitter: ModuleEmitter
) {
  const br = emitter.makeLabel("break");
  const lp = emitter.makeLabel("loop");

  // break
  emitter.writer.open(`(block ${br}`);

  // loop
  emitter.writer.open(`(loop ${lp}`);

  const condTxt = emitExpression(stmt.condExpr, emitter);
  const t = emitter.getExprType(stmt.condExpr);
  const asI32 =
    t === "bool"
      ? condTxt
      : t === "i32"
      ? `(i32.ne ${condTxt} (i32.const 0))`
      : `(f32.ne ${condTxt} (f32.const 0))`;

  // loop condition
  emitter.writer.line(`(br_if ${br} (i32.eqz ${asI32}))`);

  // loop body
  emitStatement(stmt.loopBody, emitter);

  // loop to top
  emitter.writer.line(`(br ${lp})`);

  // end loop
  emitter.writer.close(")");

  // end break
  emitter.writer.close(")");

  emitter.destroyLabel("break", br);
  emitter.destroyLabel("loop", lp);
}
