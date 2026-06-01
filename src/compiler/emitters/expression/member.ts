import { CallExpression } from "../../../parser/ast/expressions/CallExpression";
import { Identifier } from "../../../parser/ast/expressions/Identifier";
import type { MemberExpression } from "../../../parser/ast/expressions/MemberExpression";
import type { PointerMemberExpression } from "../../../parser/ast/expressions/PointerMemberExpression";
import type { StructMember } from "../../../shared/types";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { emitGet } from "./core";
import { emitFunctionCall } from "./function-call";

/**
 * Resolves a struct-member access (`a.x`, `make().x`, `getP()->x`) into a
 * WAT expression that evaluates the struct's address plus the layout info
 * for the requested field. Hides whether the base came from a local, a
 * global, or a function call.
 *
 * `basePtr` is a WAT expression that pushes the struct's i32 address on the
 * stack exactly once; callers add the member offset and load/store.
 */
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
  throw new Error(
    "[expression member] unsupported base; expected an identifier or a function call",
  );
}

function structNameOf(type: string, emitter: ModuleEmitter): string | undefined {
  const candidate = type.startsWith("*") ? type.slice(1) : type;
  return emitter.ctx.mod.structs[candidate] ? candidate : undefined;
}

function callReturnStruct(funcName: string, emitter: ModuleEmitter): string | undefined {
  const fn = emitter.ctx.mod.functions[funcName];
  const mapleResult = fn?.mapleResults?.[0];
  return mapleResult ? structNameOf(mapleResult, emitter) : undefined;
}
