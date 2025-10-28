import { Identifier } from "../../../parser/ast/expressions/Identifier.js";
import { MemberExpression } from "../../../parser/ast/expressions/MemberExpression.js";
import { PointerMemberExpression } from "../../../parser/ast/expressions/PointerMemberExpression.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";

export function getPointerMemberData(
  expr: PointerMemberExpression | MemberExpression,
  emitter: ModuleEmitter
) {
  //
  //  @TODO: figure out a way to always be able to get the
  //         identifier's struct. maybe just capture an identifier
  //         only, and dont bother with an expression, but I also
  //         want chaining: x->y->z[0]->a etc. etc.
  //
  if (expr.parent instanceof Identifier) {
    throw new Error(
      "[expression pointer_member/member] only identifier expressions on the lhs of an assignment supported"
    );
  }

  const base = expr.parent.tokenLiteral();
  const member = expr.member;

  // prefer flattened locals like base_member
  const flat = `${base}_${member}`;
  const flatVar = emitter.getVar(flat);
  if (flatVar) {
    return {
      identData: flatVar,
    };
  }

  // otherwise, use the base var and resolve struct data
  const identData = emitter.getVar(base);
  if (!identData) {
    throw new Error(`[expression member] identifier not found: "${base}"`);
  }
  let structName: string | undefined;
  if (identData.type.startsWith("*")) {
    structName = identData.type.slice(1);
  } else if (emitter.ctx.mod.structs[identData.type]) {
    structName = identData.type;
  }
  if (!structName) {
    // No struct metadata available;
    // fallback (e.g., might be storing a raw field)
    return { identData };
  }

  const structData = emitter.ctx.mod.structs[structName];
  const memberData = structData?.members[member];
  if (!memberData) {
    throw new Error(
      `[member] struct "${structName}" has no member "${member}"`
    );
  }

  return {
    identData,
    memberData,
    structData,
  };
}
