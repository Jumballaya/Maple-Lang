import { Writer } from "../../writer/Writer.js";
import { emitGet, emitNumberGet } from "./core.js";
import { emitAssignmentExpression } from "./assignment.js";
import { emitBinaryOp } from "./binary.js";
import { emitFunctionCall } from "./function-call.js";
import { emitIndexExpression } from "./index.js";
import { wasmLoadOp } from "../emit.types.js";
import { getPointerMemberData } from "./member.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { ASTExpression } from "../../../parser/ast/types/ast.type.js";
import { Identifier } from "../../../parser/ast/expressions/Identifier.js";
import { InfixExpression } from "../../../parser/ast/expressions/InfixExpression.js";
import { CallExpression } from "../../../parser/ast/expressions/CallExpression.js";
import { IntegerLiteralExpression } from "../../../parser/ast/expressions/IntegerLiteral.js";
import { BooleanLiteralExpression } from "../../../parser/ast/expressions/BooleanLiteralExpression.js";
import { CharLiteralExpression } from "../../../parser/ast/expressions/CharLiteralExpression.js";
import { StringLiteralExpression } from "../../../parser/ast/expressions/StringLiteral.js";
import { ArrayLiteralExpression } from "../../../parser/ast/expressions/ArrayLiteralExpression.js";
import { FloatLiteralExpression } from "../../../parser/ast/expressions/FloatLiteralExpression.js";
import { StructLiteralExpression } from "../../../parser/ast/expressions/StructLiteralExpression.js";
import { AssignmentExpression } from "../../../parser/ast/expressions/AssignmentExpression.js";
import { IndexExpression } from "../../../parser/ast/expressions/IndexExpression.js";
import { MemberExpression } from "../../../parser/ast/expressions/MemberExpression.js";
import { PointerMemberExpression } from "../../../parser/ast/expressions/PointerMemberExpression.js";
import { PrefixExpression } from "../../../parser/ast/expressions/PrefixExpression.js";

export function emitExpression(
  expression: ASTExpression,
  emitter: ModuleEmitter
): string {
  const writer = new Writer();

  if (expression instanceof Identifier) {
    writer.line(emitGet(expression.tokenLiteral(), emitter));
    //
  } else if (expression instanceof InfixExpression) {
    writer.line(emitBinaryOp(expression, emitter));
    //
  } else if (expression instanceof CallExpression) {
    writer.line(emitFunctionCall(expression, emitter));
    //
  } else if (expression instanceof IntegerLiteralExpression) {
    writer.line(emitNumberGet(expression.value, "i32"));
    //
  } else if (expression instanceof BooleanLiteralExpression) {
    writer.line(emitNumberGet(expression.value ? 1 : 0, "i32"));
    //
  } else if (expression instanceof CharLiteralExpression) {
    writer.line(emitNumberGet(expression.value, "i32"));
    //
  } else if (expression instanceof StringLiteralExpression) {
    // Strings are treated as pointers to the location in memory
    writer.line(`${emitNumberGet(expression.location, "i32")}`);
    //
  } else if (expression instanceof ArrayLiteralExpression) {
    writer.line(`${emitNumberGet(expression.location, "i32")}`);
    //
  } else if (expression instanceof FloatLiteralExpression) {
    writer.line(`${emitNumberGet(expression.value, "f32")}`);
    //
  } else if (expression instanceof StructLiteralExpression) {
    // @TODO: this should return the pointer to the created struct
  } else if (expression instanceof AssignmentExpression) {
    writer.line(`${emitAssignmentExpression(expression, emitter)}`);
    //
  } else if (expression instanceof IndexExpression) {
    writer.line(`${emitIndexExpression(expression, emitter)}`);
    //
  } else if (
    expression instanceof MemberExpression ||
    expression instanceof PointerMemberExpression
  ) {
    const { memberData, identData } = getPointerMemberData(expression, emitter);
    if (memberData) {
      const loadOp = wasmLoadOp(memberData.type);
      const offset = memberData.offset;
      const addr = emitGet(identData.name, emitter);
      const val = emitNumberGet(offset, "i32");
      writer.append(`(${loadOp} (i32.add ${addr} ${val}))`);
    } else {
      // no memberData means it is a flattened local ident
      writer.append(emitGet(identData.name, emitter));
    }
  } else if (expression instanceof PrefixExpression) {
    writer.append(`(i32.eqz ${emitExpression(expression.right!, emitter)})`);
    //
  } else {
    throw new Error(
      `[expression emitter] "${expression.constructor}" emit not implemented`
    );
  }

  return writer.toString();
}
