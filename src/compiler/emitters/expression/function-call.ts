import type { CallExpression } from "../../../parser/ast/expressions/CallExpression";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { Writer } from "../../writer/Writer";
import { emitExpression } from "./expression";

export function emitFunctionCall(expr: CallExpression, emitter: ModuleEmitter): string {
  const writer = new Writer();
  writer.append(`(call $${expr.func} `);

  for (const param of expr.args) {
    writer.append(emitExpression(param, emitter));
  }
  writer.append(")");
  writer.newLine();
  return writer.toString();
}
