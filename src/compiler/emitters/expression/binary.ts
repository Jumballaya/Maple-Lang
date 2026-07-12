import { CallExpression } from "../../../parser/ast/expressions/CallExpression";
import { CastExpression } from "../../../parser/ast/expressions/CastExpression";
import { Identifier } from "../../../parser/ast/expressions/Identifier";
import { IndexExpression } from "../../../parser/ast/expressions/IndexExpression";
import type { InfixExpression } from "../../../parser/ast/expressions/InfixExpression";
import { MemberExpression } from "../../../parser/ast/expressions/MemberExpression";
import { PointerMemberExpression } from "../../../parser/ast/expressions/PointerMemberExpression";
import { StringLiteralExpression } from "../../../parser/ast/expressions/StringLiteral";
import type { ASTExpression } from "../../../parser/ast/types/ast.type";
import type { ModuleEmitter } from "../../ModuleEmitter";
import type { WasmValueType } from "../emit.types";
import {
  baseScalar,
  f64CompareOp,
  i32CompareOp,
  i64CompareOp,
  isUnsignedMapleInteger,
  valueTypeToWasm,
} from "../emit.types";
import { emitExpression } from "./expression";

function wasmTypeOfExpr(e: ASTExpression, emitter: ModuleEmitter): WasmValueType {
  const t = emitter.getExprType(e);
  if (t === null) {
    throw new Error("unable to resolve expression type");
  }
  if (t === "bool") return "i32";
  return valueTypeToWasm(t);
}

export function emitOperand(
  e: ASTExpression,
  target: WasmValueType,
  emitter: ModuleEmitter,
): string {
  const raw = emitExpression(e, emitter);
  const src = wasmTypeOfExpr(e, emitter);
  if (src === target) return raw;
  // Integer signedness drives convert/extend opcodes. Float-side signs are
  // bitwise (promote/demote/wrap), and unused float→int paths still default
  // to signed because the operand's *target* signedness isn't reachable here.
  const srcMt = emitter.getExprType(e);
  const srcSign = srcMt !== null && isUnsignedMapleInteger(srcMt) ? "u" : "s";
  if (src === "i32" && target === "f32") {
    return `(f32.convert_i32_${srcSign} ${raw})`;
  }
  if (src === "f32" && target === "i32") {
    return `(i32.trunc_f32_s ${raw})`;
  }
  if (src === "i32" && target === "i64") {
    return `(i64.extend_i32_${srcSign} ${raw})`;
  }
  if (src === "i64" && target === "i32") {
    return `(i32.wrap_i64 ${raw})`;
  }
  if (src === "f32" && target === "f64") {
    return `(f64.promote_f32 ${raw})`;
  }
  if (src === "f64" && target === "f32") {
    return `(f32.demote_f64 ${raw})`;
  }
  if (src === "i32" && target === "f64") {
    return `(f64.convert_i32_${srcSign} ${raw})`;
  }
  if (src === "f64" && target === "i32") {
    return `(i32.trunc_f64_s ${raw})`;
  }
  if (src === "i64" && target === "f64") {
    return `(f64.convert_i64_${srcSign} ${raw})`;
  }
  if (src === "f64" && target === "i64") {
    return `(i64.trunc_f64_s ${raw})`;
  }
  if (src === "f32" && target === "i64") {
    return `(i64.trunc_f32_s ${raw})`;
  }
  if (src === "i64" && target === "f32") {
    return `(f32.convert_i64_${srcSign} ${raw})`;
  }
  throw new Error(`emitOperand: cannot widen/narrow ${src} to ${target}`);
}

function truthyToI32(e: ASTExpression, w: WasmValueType, emitter: ModuleEmitter): string {
  const v = emitOperand(e, w, emitter);
  if (w === "f32") return `(f32.ne ${v} (f32.const 0))`;
  if (w === "f64") return `(f64.ne ${v} (f64.const 0))`;
  if (w === "i64") return `(i64.ne ${v} (i64.const 0))`;
  return `(i32.ne ${v} (i32.const 0))`;
}

// Maple-level type when it can name a struct or string, which the
// lane-oriented getExprType flattens to i32.
function aggregateTypeOf(e: ASTExpression, emitter: ModuleEmitter): string | null {
  if (e instanceof StringLiteralExpression) return "string";
  if (e instanceof Identifier) return emitter.getVar(e.tokenLiteral())?.type ?? null;
  if (e instanceof CastExpression) return e.targetType;
  if (e instanceof CallExpression) {
    return emitter.ctx.mod.functions[e.func]?.mapleResults[0] ?? null;
  }
  if (e instanceof IndexExpression) {
    const v = emitter.getVar(e.left.tokenLiteral());
    return v ? baseScalar(v.type) : null;
  }
  if (e instanceof MemberExpression || e instanceof PointerMemberExpression) {
    if (!(e.parent instanceof Identifier)) return null;
    const v = emitter.getVar(e.parent.tokenLiteral());
    if (!v) return null;
    const structName = v.type.startsWith("*") ? v.type.slice(1) : v.type;
    return emitter.ctx.mod.structs[structName]?.members[e.member]?.type ?? null;
  }
  return null;
}

// `==`/`!=` on strings compares content, on structs field-wise; null falls
// through to plain numeric comparison.
function emitAggregateEquality(expr: InfixExpression, emitter: ModuleEmitter): string | null {
  const lt = aggregateTypeOf(expr.left, emitter);
  const rt = aggregateTypeOf(expr.right, emitter);
  if (lt === null || lt !== rt) return null;

  let eqFn: string;
  if (lt === "string") {
    emitter.needsStringEq = true;
    eqFn = "$__string_eq";
  } else if (emitter.getStruct(lt)) {
    emitter.structEqNames.add(lt);
    eqFn = `$__struct_eq_${lt}`;
  } else {
    return null;
  }

  const l = emitExpression(expr.left, emitter);
  const r = emitExpression(expr.right, emitter);
  const eq = `(call ${eqFn} ${l} ${r})`;
  return expr.operator === "==" ? eq : `(i32.eqz ${eq})`;
}

export function emitBinaryOp(expr: InfixExpression, emitter: ModuleEmitter): string {
  if (expr.operator === "==" || expr.operator === "!=") {
    const aggregate = emitAggregateEquality(expr, emitter);
    if (aggregate) return aggregate;
  }

  const [numType, , signedInt] = emitter.resolveBinaryOpTypes(expr.left, expr.right);
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
      if (numType === "f32" || numType === "f64") {
        return `(${numType}.div ${l} ${r})`;
      }
      const op = signedInt ? `${numType}.div_s` : `${numType}.div_u`;
      return `(${op} ${l} ${r})`;
    }
    case "%": {
      if (numType === "f32") {
        return `(f32.sub ${l} (f32.mul (f32.trunc (f32.div ${l} ${r})) ${r}))`;
      }
      if (numType === "f64") {
        return `(f64.sub ${l} (f64.mul (f64.trunc (f64.div ${l} ${r})) ${r}))`;
      }
      const op = signedInt ? `${numType}.rem_s` : `${numType}.rem_u`;
      return `(${op} ${l} ${r})`;
    }
    case "==": {
      if (numType === "f32") return `(f32.eq ${l} ${r})`;
      if (numType === "f64") return `(f64.eq ${l} ${r})`;
      if (numType === "i64") return `(i64.eq ${l} ${r})`;
      return `(i32.eq ${l} ${r})`;
    }
    case "!=": {
      if (numType === "f32") return `(f32.ne ${l} ${r})`;
      if (numType === "f64") return `(f64.ne ${l} ${r})`;
      if (numType === "i64") return `(i64.ne ${l} ${r})`;
      return `(i32.ne ${l} ${r})`;
    }
    case ">": {
      if (numType === "f32") return `(f32.gt ${l} ${r})`;
      if (numType === "f64") return `(${f64CompareOp(">")} ${l} ${r})`;
      if (numType === "i64") return `(${i64CompareOp(">", signedInt)} ${l} ${r})`;
      return `(${i32CompareOp(">", signedInt)} ${l} ${r})`;
    }
    case "<": {
      if (numType === "f32") return `(f32.lt ${l} ${r})`;
      if (numType === "f64") return `(${f64CompareOp("<")} ${l} ${r})`;
      if (numType === "i64") return `(${i64CompareOp("<", signedInt)} ${l} ${r})`;
      return `(${i32CompareOp("<", signedInt)} ${l} ${r})`;
    }
    case ">=": {
      if (numType === "f32") return `(f32.ge ${l} ${r})`;
      if (numType === "f64") return `(${f64CompareOp(">=")} ${l} ${r})`;
      if (numType === "i64") return `(${i64CompareOp(">=", signedInt)} ${l} ${r})`;
      return `(${i32CompareOp(">=", signedInt)} ${l} ${r})`;
    }
    case "<=": {
      if (numType === "f32") return `(f32.le ${l} ${r})`;
      if (numType === "f64") return `(${f64CompareOp("<=")} ${l} ${r})`;
      if (numType === "i64") return `(${i64CompareOp("<=", signedInt)} ${l} ${r})`;
      return `(${i32CompareOp("<=", signedInt)} ${l} ${r})`;
    }
    case "&&": {
      const li = truthyToI32(expr.left, numType, emitter);
      const ri = truthyToI32(expr.right, numType, emitter);
      return `(if (result i32) ${li} (then ${ri}) (else (i32.const 0)))`;
    }
    case "||": {
      const li = truthyToI32(expr.left, numType, emitter);
      const ri = truthyToI32(expr.right, numType, emitter);
      return `(if (result i32) ${li} (then (i32.const 1)) (else ${ri}))`;
    }
    case "&": {
      return `(${numType}.and ${l} ${r})`;
    }
    case "|": {
      return `(${numType}.or ${l} ${r})`;
    }
    case "^": {
      return `(${numType}.xor ${l} ${r})`;
    }
    case "<<": {
      return `(${numType}.shl ${l} ${r})`;
    }
    case ">>": {
      if (numType === "f32" || numType === "f64") {
        throw new Error("shift on float");
      }
      const op = signedInt ? `${numType}.shr_s` : `${numType}.shr_u`;
      return `(${op} ${l} ${r})`;
    }
    default: {
      throw new Error("not implemented");
    }
  }
}
