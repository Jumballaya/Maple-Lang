import { Identifier } from "../../../parser/ast/expressions/Identifier";
import { IndexExpression } from "../../../parser/ast/expressions/IndexExpression";
import { MemberExpression } from "../../../parser/ast/expressions/MemberExpression";
import { PointerMemberExpression } from "../../../parser/ast/expressions/PointerMemberExpression";
import type { ASTExpression } from "../../../parser/ast/types/ast.type";
import type { ModuleEmitter } from "../../ModuleEmitter";
import type { WasmValueType } from "../emit.types";
import { baseScalar, valueTypeToWasm, wasmLoadOp, wasmStoreOp } from "../emit.types";
import { emitGet } from "./core";
import { arrayElementAddr } from "./index";
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
    store: (rhs) => `(${setOp} $${v.name} ${rhs})`,
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
  const name = target.left.tokenLiteral();
  const varData = emitter.getVar(name);
  if (!varData) {
    throw new Error(`[lvalue] unknown array: "${name}"`);
  }
  const elemType = baseScalar(varData.type);
  const addr = arrayElementAddr(name, elemType, target.index, emitter);
  return {
    load: `(${wasmLoadOp(elemType)} ${addr})`,
    store: (rhs) => `(${wasmStoreOp(elemType)} ${addr} ${rhs})`,
    lane: valueTypeToWasm(elemType),
  };
}
