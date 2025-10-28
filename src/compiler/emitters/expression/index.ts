import { IndexExpression } from "../../../parser/ast/expressions/IndexExpression.js";
import { IntegerLiteralExpression } from "../../../parser/ast/expressions/IntegerLiteral.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { Writer } from "../../writer/Writer.js";
import { baseScalar, sizeofType, wasmLoadOp } from "../emit.types.js";
import { emitGet } from "./core.js";
import { emitExpression } from "./expression.js";

export function emitIndexExpression(
  expression: IndexExpression,
  emitter: ModuleEmitter
): string {
  const writer = new Writer();

  //
  // Extract the type we are pulling out of the array
  const varData = emitter.getVar(expression.left.tokenLiteral());
  if (!varData) {
    throw new Error(`unknown variable : ${expression.left.tokenLiteral()}`);
  }
  const arrayType = varData.type;
  const memberType = baseScalar(arrayType);
  const memberSize = sizeofType(memberType);
  const loadOp = wasmLoadOp(memberType);

  // if it is index 0 as a number literal, just use
  // the base pointer of the array, no math
  if (
    expression.index instanceof IntegerLiteralExpression &&
    expression.index.value === 0
  ) {
    writer.append(`(${loadOp} ${emitGet(varData.name, emitter)})`);

    // otherwise, we need to evaluate the expression
    // as the index
  } else {
    const base = emitGet(varData.name, emitter);
    const index = emitExpression(expression.index, emitter);
    writer.append(
      `(${loadOp} (i32.add ${base} (i32.mul ${index} (i32.const ${memberSize}))))`
    );
  }

  return writer.toString();
}
