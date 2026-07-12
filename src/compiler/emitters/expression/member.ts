import { CallExpression } from "../../../parser/ast/expressions/CallExpression";
import { Identifier } from "../../../parser/ast/expressions/Identifier";
import { IndexExpression } from "../../../parser/ast/expressions/IndexExpression";
import { MemberExpression } from "../../../parser/ast/expressions/MemberExpression";
import { PointerMemberExpression } from "../../../parser/ast/expressions/PointerMemberExpression";
import type { StructMember } from "../../../shared/types";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { baseScalar, wasmLoadOp } from "../emit.types";
import { emitGet } from "./core";
import { emitFunctionCall } from "./function-call";
import { emitIndexExpression } from "./index";

// `basePtr` is a WAT expression pushing the struct's address exactly once;
// callers add memberData.offset and load/store.
export function resolveStructMember(
  expr: PointerMemberExpression | MemberExpression,
  emitter: ModuleEmitter,
): { basePtr: string; memberData: StructMember } {
  const { basePtr, structName } = resolveBase(expr.parent, emitter);
  const memberData = emitter.ctx.mod.structs[structName]?.members[expr.member];
  if (!memberData) {
    throw new Error(`[member] struct "${structName}" has no member "${expr.member}"`);
  }
  return { basePtr, memberData };
}

function resolveBase(
  base: PointerMemberExpression["parent"],
  emitter: ModuleEmitter,
): { basePtr: string; structName: string } {
  if (base instanceof Identifier) {
    const name = base.tokenLiteral();
    const v = emitter.getVar(name);
    if (!v) {
      throw new Error(`[expression member] identifier not found: "${name}"`);
    }
    const structName = structNameOf(v.type, emitter);
    if (!structName) {
      throw new Error(`[expression member] "${name}" is not a struct-typed binding`);
    }
    return { basePtr: emitGet(name, emitter), structName };
  }
  if (base instanceof CallExpression) {
    const structName = callReturnStruct(base.func, emitter);
    if (!structName) {
      throw new Error(
        `[expression member] call to "${base.func}" does not return a struct-typed value`,
      );
    }
    return { basePtr: emitFunctionCall(base, emitter), structName };
  }
  if (base instanceof MemberExpression || base instanceof PointerMemberExpression) {
    const { basePtr, memberData } = resolveStructMember(base, emitter);
    const structName = structNameOf(memberData.type, emitter);
    if (!structName) {
      throw new Error(`[expression member] member "${base.member}" is not a struct-typed value`);
    }
    const addr = `(${wasmLoadOp("i32")} (i32.add ${basePtr} (i32.const ${memberData.offset})))`;
    return { basePtr: addr, structName };
  }
  if (base instanceof IndexExpression) {
    const arrayVar = emitter.getVar(base.left.tokenLiteral());
    const elemType = baseScalar(arrayVar?.type ?? "");
    const structName = structNameOf(elemType, emitter);
    if (!structName) {
      throw new Error(`[expression member] array element type "${elemType}" is not a struct`);
    }
    return { basePtr: emitIndexExpression(base, emitter), structName };
  }
  throw new Error(
    "[expression member] unsupported base; expected an identifier, member, index, or call",
  );
}

function structNameOf(type: string, emitter: ModuleEmitter): string | undefined {
  // Arrays share the string header layout: {len: i32, data: *elem}.
  if (type.endsWith("[]")) return "string";
  const candidate = type.startsWith("*") ? type.slice(1) : type;
  return emitter.ctx.mod.structs[candidate] ? candidate : undefined;
}

function callReturnStruct(funcName: string, emitter: ModuleEmitter): string | undefined {
  const fn = emitter.ctx.mod.functions[funcName];
  const mapleResult = fn?.mapleResults?.[0];
  return mapleResult ? structNameOf(mapleResult, emitter) : undefined;
}
