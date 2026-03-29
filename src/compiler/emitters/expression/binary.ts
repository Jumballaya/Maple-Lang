import type { InfixExpression } from "../../../parser/ast/expressions/InfixExpression";
import type { ASTExpression } from "../../../parser/ast/types/ast.type";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { i32CompareOp } from "../emit.types";
import { emitExpression } from "./expression";

//
//  Automatically convert from f32 -> i32 and i32 -> f32 when needed
//
export function emitOperand(
  e: ASTExpression,
  target: "i32" | "f32",
  emitter: ModuleEmitter,
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
export function emitBinaryOp(expr: InfixExpression, emitter: ModuleEmitter): string {
  const [numType] = emitter.resolveBinaryOpTypes(expr.left, expr.right);
  const l = emitOperand(expr.left, numType, emitter);
  const r = emitOperand(expr.right, numType, emitter);
  const li32 = emitOperand(expr.left, "i32", emitter);
  const ri32 = emitOperand(expr.right, "i32", emitter);

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
    case "%": {
      return `(i32.rem_s ${li32} ${ri32})`;
    }
    case "==": {
      const op = numType === "f32" ? "f32.eq" : "i32.eq";
      return `(${op} ${l} ${r})`;
    }
    case "!=": {
      const op = numType === "f32" ? "f32.ne" : "i32.ne";
      return `(${op} ${l} ${r})`;
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
    case "&&": {
      return `(i32.and ${li32} ${ri32})`;
    }
    case "||": {
      return `(i32.or ${li32} ${ri32})`;
    }
    case "&": {
      return `(i32.and ${li32} ${ri32})`;
    }
    case "|": {
      return `(i32.or ${li32} ${ri32})`;
    }
    case "^": {
      return `(i32.xor ${li32} ${ri32})`;
    }
    case "<<": {
      return `(i32.shl ${li32} ${ri32})`;
    }
    case ">>": {
      return `(i32.shr_s ${li32} ${ri32})`;
    }
    default: {
      throw new Error("not implemented");
    }
  }
}
