import type { CallExpression } from "../../../parser/ast/expressions/CallExpression";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { Writer } from "../../writer/Writer";
import { fnTypeToSigName, isFnType } from "../emit.types";
import type { VariableMeta } from "../emitter.types";
import { emitExpression } from "./expression";

export function emitFunctionCall(expr: CallExpression, emitter: ModuleEmitter): string {
  const fnVar = emitter.getVar(expr.func);
  if (fnVar && isFnType(fnVar.type)) {
    return emitIndirectCall(expr, fnVar, emitter);
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

function varPtrWat(name: string, v: VariableMeta): string {
  switch (v.scope) {
    case "local":
    case "param":
      return `(local.get $${name})`;
    case "global":
      return `(global.get $${name})`;
    default:
      return `(local.get $${name})`;
  }
}

function emitIndirectCall(
  expr: CallExpression,
  fnVar: VariableMeta,
  emitter: ModuleEmitter,
): string {
  const sigName = fnTypeToSigName(fnVar.type);
  const ptr = varPtrWat(expr.func, fnVar);

  let out = `(call_indirect (type ${sigName})`;
  out += ` (i32.load offset=4 ${ptr})`; // env
  for (const arg of expr.args) {
    out += ` ${emitExpression(arg, emitter)}`;
  }
  out += ` (i32.load offset=0 ${ptr})`; // idx (table index)
  out += ")";
  return out;
}
