import { Identifier } from "../../../parser/ast/expressions/Identifier";
import { IndexExpression } from "../../../parser/ast/expressions/IndexExpression";
import { IntegerLiteralExpression } from "../../../parser/ast/expressions/IntegerLiteral";
import { MemberExpression } from "../../../parser/ast/expressions/MemberExpression";
import { PointerMemberExpression } from "../../../parser/ast/expressions/PointerMemberExpression";
import type { ASTExpression } from "../../../parser/ast/types/ast.type";
import type { ModuleEmitter } from "../../ModuleEmitter";
import type { WasmValueType } from "../emit.types";
import { baseScalar, sizeofType, valueTypeToWasm, wasmLoadOp, wasmStoreOp } from "../emit.types";
import { emitGet } from "./core";
import { emitExpression } from "./expression";
import { resolveStructMember } from "./member";

/**
 * A storable lvalue: an identifier, a struct field, or an array element.
 *
 * `load` reads the current value; `store(rhs)` writes a new one. Both are
 * single self-contained WAT expressions, so callers can use them in any
 * position (`return`, `block`, `set`).
 *
 * Note: the base address / index expressions are inlined into each WAT
 * string. If the base has side effects (a function call, a postfix), it
 * runs once per access. Callers needing read-modify-write on a side-
 * effectful base must spill the base to a local before constructing.
 */
export type Lvalue = {
  load: string;
  store: (rhs: string) => string;
  lane: WasmValueType;
};

export function toLvalue(target: ASTExpression, emitter: ModuleEmitter): Lvalue {
  if (target instanceof Identifier) {
    return identLvalue(target, emitter);
  }
  if (target instanceof MemberExpression || target instanceof PointerMemberExpression) {
    return memberLvalue(target, emitter);
  }
  if (target instanceof IndexExpression) {
    return indexLvalue(target, emitter);
  }
  throw new Error(`[lvalue] not assignable: ${target.constructor.name} ("${target.toString()}")`);
}

function identLvalue(ident: Identifier, emitter: ModuleEmitter): Lvalue {
  const name = ident.tokenLiteral();
  const v = emitter.getVar(name);
  if (!v) {
    throw new Error(`[lvalue] variable not found: "${name}"`);
  }
  const mt = emitter.getExprType(ident);
  const lane = mt === null ? "i32" : valueTypeToWasm(mt);
  const setOp = v.scope === "global" ? "global.set" : "local.set";
  return {
    load: emitGet(name, emitter),
    store: (rhs) => `(${setOp} $${name} ${rhs})`,
    lane,
  };
}

function memberLvalue(
  target: MemberExpression | PointerMemberExpression,
  emitter: ModuleEmitter,
): Lvalue {
  const { basePtr, memberData } = resolveStructMember(target, emitter);
  const addr = `(i32.add ${basePtr} (i32.const ${memberData.offset}))`;
  const loadOp = wasmLoadOp(memberData.type);
  const storeOp = wasmStoreOp(memberData.type);
  return {
    load: `(${loadOp} ${addr})`,
    store: (rhs) => `(${storeOp} ${addr} ${rhs})`,
    lane: valueTypeToWasm(memberData.type),
  };
}

function indexLvalue(target: IndexExpression, emitter: ModuleEmitter): Lvalue {
  const varData = emitter.getVar(target.left.tokenLiteral());
  if (!varData) {
    throw new Error(`[lvalue] unknown array: "${target.left.tokenLiteral()}"`);
  }
  const elemType = baseScalar(varData.type);
  const elemSize = sizeofType(elemType);
  const loadOp = wasmLoadOp(elemType);
  const storeOp = wasmStoreOp(elemType);
  const base = emitGet(varData.name, emitter);
  const addr =
    target.index instanceof IntegerLiteralExpression && target.index.value === 0
      ? base
      : `(i32.add ${base} (i32.mul ${emitExpression(target.index, emitter)} (i32.const ${elemSize})))`;
  return {
    load: `(${loadOp} ${addr})`,
    store: (rhs) => `(${storeOp} ${addr} ${rhs})`,
    lane: valueTypeToWasm(elemType),
  };
}
