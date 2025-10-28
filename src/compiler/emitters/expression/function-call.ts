import { CallExpression } from "../../../parser/ast/expressions/CallExpression.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { Writer } from "../../writer/Writer.js";
import { emitExpression } from "./expression.js";

export function emitFunctionCall(
  expr: CallExpression,
  emitter: ModuleEmitter
): string {
  const writer = new Writer();
  writer.append(`(call $${expr.func} `);

  for (const param of expr.args) {
    writer.append(emitExpression(param, emitter));
  }
  writer.append(")");
  writer.newLine();
  return writer.toString();
}
