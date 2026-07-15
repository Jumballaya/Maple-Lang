import type { CallExpression } from "../../../parser/ast/expressions/CallExpression";
import { Identifier } from "../../../parser/ast/expressions/Identifier";
import { getIntrinsic } from "../../intrinsics";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { Writer } from "../../writer/Writer";
import { fnTypeToSigName, isFnType } from "../emit.types";
import type { VariableMeta } from "../emitter.types";
import { emitExpression } from "./expression";

export function emitFunctionCall(expr: CallExpression, emitter: ModuleEmitter): string {
  const intrinsic = getIntrinsic(expr.func);
  if (intrinsic) {
    const args = expr.args.map((arg) => emitExpression(arg, emitter));
    const operands = args.length === 0 ? "" : ` ${args.join(" ")}`;
    return `(${intrinsic.instruction}${operands})`;
  }

  const fnVar = emitter.getVar(expr.func);
  if (fnVar && isFnType(fnVar.type)) {
    return emitIndirectCallViaLocal(expr, fnVar, emitter);
  }

  // `h.cb(args)` arrives here as a CallExpression with name `Struct_cb` and
  // args `[h, ...realArgs]`. If `cb` is a fn-typed field (not a method),
  // dispatch via the field's stored fn-ref instead of calling a method.
  const fnField = resolveFnTypedField(expr, emitter);
  if (fnField) {
    return emitIndirectCallViaField(expr, fnField, emitter);
  }

  const writer = new Writer();
  writer.append(`(call $${expr.func} `);
  for (const param of expr.args) {
    writer.append(emitExpression(param, emitter));
  }
  writer.append(")");
  writer.newLine();
  return writer.toString();
}

function varPtrWat(v: VariableMeta): string {
  return v.scope === "global" ? `(global.get $${v.name})` : `(local.get $${v.name})`;
}

function emitIndirectCallViaLocal(
  expr: CallExpression,
  fnVar: VariableMeta,
  emitter: ModuleEmitter,
): string {
  const sigName = fnTypeToSigName(fnVar.type);
  const ptr = varPtrWat(fnVar);

  let out = `(call_indirect (type ${sigName})`;
  out += ` (i32.load offset=4 ${ptr})`; // env
  for (const arg of expr.args) {
    out += ` ${emitExpression(arg, emitter)}`;
  }
  out += ` (i32.load offset=0 ${ptr})`; // idx (table index)
  out += ")";
  return out;
}

type FnField = {
  receiver: VariableMeta;
  fieldOffset: number;
  fieldType: string;
};

function resolveFnTypedField(expr: CallExpression, emitter: ModuleEmitter): FnField | undefined {
  // The parser mangles `recv.member(...)` to `Struct_member` with the receiver
  // prepended to the args. Recover the receiver from the first arg, then look
  // up the field on the struct.
  const first = expr.args[0];
  if (!(first instanceof Identifier)) return undefined;
  const receiver = emitter.getVar(first.tokenLiteral());
  if (!receiver) return undefined;
  const structName = receiver.type.startsWith("*") ? receiver.type.slice(1) : receiver.type;
  const structDef = emitter.ctx.mod.structs[structName];
  if (!structDef) return undefined;
  const expectedFunc = `${structName}_`;
  if (!expr.func.startsWith(expectedFunc)) return undefined;
  const fieldName = expr.func.slice(expectedFunc.length);
  const member = structDef.members[fieldName];
  if (!member || !isFnType(member.type)) return undefined;
  return { receiver, fieldOffset: member.offset, fieldType: member.type };
}

function emitIndirectCallViaField(
  expr: CallExpression,
  field: FnField,
  emitter: ModuleEmitter,
): string {
  const sigName = fnTypeToSigName(field.fieldType);
  // Load the fn-ref pointer stored at receiver+offset. The pointer addresses
  // a {idx, env} pair just like a fn-typed local does.
  const recvPtr = varPtrWat(field.receiver);
  const ptr = `(i32.load (i32.add ${recvPtr} (i32.const ${field.fieldOffset})))`;

  let out = `(call_indirect (type ${sigName})`;
  out += ` (i32.load offset=4 ${ptr})`; // env
  // Skip the prepended receiver (args[0]) — the indirect call doesn't take it.
  for (let i = 1; i < expr.args.length; i++) {
    const arg = expr.args[i];
    if (arg) out += ` ${emitExpression(arg, emitter)}`;
  }
  out += ` (i32.load offset=0 ${ptr})`; // idx
  out += ")";
  return out;
}
