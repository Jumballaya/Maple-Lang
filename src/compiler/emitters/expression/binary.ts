import { InfixExpression } from "../../../parser/ast/expressions/InfixExpression.js";
import { ASTExpression } from "../../../parser/ast/types/ast.type.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { i32CompareOp } from "../emit.types.js";
import { emitExpression } from "./expression.js";

//
//  Automatically convert from f32 -> i32 and i32 -> f32 when needed
//
export function emitOperand(
  e: ASTExpression,
  target: "i32" | "f32",
  emitter: ModuleEmitter
): string {
  const raw = emitExpression(e, emitter);
  let src = emitter.getExprType(e);
  if (src === "bool") src = "i32";
  if (target === "f32" && src === "i32") {
    return `(f32.convert_i32_s ${raw})`;
  }
  if (target === "i32" && src === "f32") {
    return `(i32.trunc_f32_s ${raw})`;
  }
  return raw;
}

//
//  @TODO: use correct operations
//
export function emitBinaryOp(
  expr: InfixExpression,
  emitter: ModuleEmitter
): string {
  const [numType] = emitter.resolveBinaryOpTypes(expr.left, expr.right);
  const l = emitOperand(expr.left, numType, emitter);
  const r = emitOperand(expr.right, numType, emitter);

  switch (expr.operator) {
    case "+": {
      return `(${numType}.add ${l} ${r})`;
    }
    case "-": {
      return `(${numType}.sub ${l} ${r})`;
    }
    case "*": {
      return `(${numType}.mul ${l} ${r})`;
    }
    case "/": {
      const op = numType === "f32" ? "div" : "div_s";
      return `(${numType}.${op} ${l} ${r})`;
    }
    case ">": {
      const op = i32CompareOp(">", numType !== "f32");
      return `(${op} ${l} ${r})`;
    }
    case "<": {
      const op = i32CompareOp("<", numType !== "f32");
      return `(${op} ${l} ${r})`;
    }
    case ">=": {
      const op = i32CompareOp(">=", numType !== "f32");
      return `(${op} ${l} ${r})`;
    }
    case "<=": {
      const op = i32CompareOp("<=", numType !== "f32");
      return `(${op} ${l} ${r})`;
    }
    default: {
      throw new Error("not implemented");
    }
  }
}
