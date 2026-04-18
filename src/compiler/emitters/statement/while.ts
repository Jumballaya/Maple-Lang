import type { WhileStatement } from "../../../parser/ast/statements/WhileStatement";
import { MapleError } from "../../errors";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { valueTypeToWasm } from "../emit.types";
import { emitExpression } from "../expression/expression";
import { emitStatement } from "./statement";

export function emitWhileStatement(stmt: WhileStatement, emitter: ModuleEmitter) {
  const br = emitter.makeLabel("break");
  const lp = emitter.makeLabel("loop");

  // break
  emitter.writer.open(`(block ${br}`);

  // loop
  emitter.writer.open(`(loop ${lp}`);

  const condTxt = emitExpression(stmt.condExpr, emitter);
  const t = emitter.getExprType(stmt.condExpr);
  if (t === null) {
    throw new MapleError(
      "while loop condition must be a numeric or boolean expression, got '<multi>'",
      stmt.token.line,
      stmt.token.col,
    );
  }
  let asI32: string;
  if (t === "bool") {
    asI32 = condTxt;
  } else if (t === "void") {
    throw new MapleError(
      `while loop condition must be a numeric or boolean expression, got 'void'`,
      stmt.token.line,
      stmt.token.col,
    );
  } else {
    const w = valueTypeToWasm(t);
    if (w === "i32") {
      asI32 = `(i32.ne ${condTxt} (i32.const 0))`;
    } else if (w === "i64") {
      asI32 = `(i64.ne ${condTxt} (i64.const 0))`;
    } else if (w === "f32") {
      asI32 = `(f32.ne ${condTxt} (f32.const 0))`;
    } else if (w === "f64") {
      asI32 = `(f64.ne ${condTxt} (f64.const 0))`;
    } else {
      throw new MapleError(
        `while loop condition must be a numeric or boolean expression, got '${t}'`,
        stmt.token.line,
        stmt.token.col,
      );
    }
  }

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
