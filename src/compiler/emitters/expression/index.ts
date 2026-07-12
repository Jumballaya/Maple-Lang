import type { IndexExpression } from "../../../parser/ast/expressions/IndexExpression";
import type { ASTExpression } from "../../../parser/ast/types/ast.type";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { baseScalar, sizeofType, wasmLoadOp } from "../emit.types";
import { emitGet } from "./core";
import { emitExpression } from "./expression";

// Bounds-checked address of `array[index]`; $__elem_addr traps on
// out-of-range (negative indices wrap to huge unsigned values).
export function arrayElementAddr(
  arrayName: string,
  elemType: string,
  index: ASTExpression,
  emitter: ModuleEmitter,
): string {
  emitter.needsArrayRuntime = true;
  const base = emitGet(arrayName, emitter);
  const idx = emitExpression(index, emitter);
  return `(call $__elem_addr ${base} ${idx} (i32.const ${sizeofType(elemType)}))`;
}

export function emitIndexExpression(expression: IndexExpression, emitter: ModuleEmitter): string {
  const name = expression.left.tokenLiteral();
  const varData = emitter.getVar(name);
  if (!varData) {
    throw new Error(`unknown variable : ${name}`);
  }
  const elemType = baseScalar(varData.type);
  return `(${wasmLoadOp(elemType)} ${arrayElementAddr(name, elemType, expression.index, emitter)})`;
}
