import { Identifier } from "../../../parser/ast/expressions/Identifier";
import type { MemberExpression } from "../../../parser/ast/expressions/MemberExpression";
import type { PointerMemberExpression } from "../../../parser/ast/expressions/PointerMemberExpression";
import type { ModuleEmitter } from "../../ModuleEmitter";

export function getPointerMemberData(
  expr: PointerMemberExpression | MemberExpression,
  emitter: ModuleEmitter,
) {
  //
  //  @TODO: figure out a way to always be able to get the
  //         identifier's struct. maybe just capture an identifier
  //         only, and dont bother with an expression, but I also
  //         want chaining: x->y->z[0]->a etc. etc.
  //
  if (!(expr.parent instanceof Identifier)) {
    throw new Error(
      "[expression pointer_member/member] only identifier expressions on the lhs of an assignment supported",
    );
  }

  const base = expr.parent.tokenLiteral();
  const member = expr.member;

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
    throw new Error(`[expression member] "${base}" is not a struct-typed binding`);
  }

  const structData = emitter.ctx.mod.structs[structName];
  const memberData = structData?.members[member];
  if (!memberData) {
    throw new Error(`[member] struct "${structName}" has no member "${member}"`);
  }

  return {
    identData,
    memberData,
    structData,
  };
}
