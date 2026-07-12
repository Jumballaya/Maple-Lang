import type { AssignmentExpression } from "../../../parser/ast/expressions/AssignmentExpression";
import { Identifier } from "../../../parser/ast/expressions/Identifier";
import { IndexExpression } from "../../../parser/ast/expressions/IndexExpression";
import { InfixExpression } from "../../../parser/ast/expressions/InfixExpression";
import { MemberExpression } from "../../../parser/ast/expressions/MemberExpression";
import { PointerMemberExpression } from "../../../parser/ast/expressions/PointerMemberExpression";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { Writer } from "../../writer/Writer";
import { baseScalar, wasmStoreOp } from "../emit.types";
import { emitSet } from "./core";
import { emitExpression } from "./expression";
import { arrayElementAddr } from "./index";
import { resolveStructMember } from "./member";

const compoundOps: Record<string, string> = {
  "+=": "+",
  "-=": "-",
  "*=": "*",
  "/=": "/",
  "%=": "%",
  "|=": "|",
  "&=": "&",
  "^=": "^",
  "<<=": "<<",
  ">>=": ">>",
};

export function emitAssignmentExpression(
  expression: AssignmentExpression,
  emitter: ModuleEmitter,
): string {
  const writer = new Writer();
  if (!expression.value) {
    throw new Error("[expression emitter] assignment expression missing rhs");
  }

  if (expression.left instanceof Identifier) {
    const name = expression.left.tokenLiteral();
    const op = compoundOps[expression.operator];
    if (!op) {
      writer.line(emitSet(name, expression.value, emitter));
    } else {
      const rhs = new InfixExpression(
        expression.token,
        new Identifier(expression.left.token, expression.left.typeAnnotation),
        op,
        expression.value,
      );
      writer.line(emitSet(name, rhs, emitter));
    }
  } else if (expression.left instanceof IndexExpression) {
    if (expression.operator !== "=") {
      throw new Error(
        "[expression emitter] compound assignment for index expressions not implemented",
      );
    }
    const name = expression.left.left.tokenLiteral();
    const varData = emitter.getVar(name);
    if (!varData) {
      throw new Error(`[expression emitter] unknown array variable: "${name}"`);
    }
    const elemType = baseScalar(varData.type);
    const addr = arrayElementAddr(name, elemType, expression.left.index, emitter);
    const val = emitExpression(expression.value, emitter);
    writer.line(`(${wasmStoreOp(elemType)} ${addr} ${val})`);
  } else if (
    expression.left instanceof MemberExpression ||
    expression.left instanceof PointerMemberExpression
  ) {
    const { basePtr, memberData } = resolveStructMember(expression.left, emitter);
    const addr = `(i32.add ${basePtr} (i32.const ${memberData.offset}))`;
    const storeOp = wasmStoreOp(memberData.type);
    const op = compoundOps[expression.operator];
    const rhs = op
      ? new InfixExpression(expression.token, expression.left, op, expression.value)
      : expression.value;
    const val = emitExpression(rhs, emitter);
    writer.line(`(${storeOp} ${addr} ${val})`);
  } else {
    throw new Error(
      `[expression emitter] Assignment expression type: "${expression.left.toString()}" not supported`,
    );
  }

  return writer.toString();
}
