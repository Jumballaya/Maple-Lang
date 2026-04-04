import type { AssignmentExpression } from "../../../parser/ast/expressions/AssignmentExpression";
import { Identifier } from "../../../parser/ast/expressions/Identifier";
import { IndexExpression } from "../../../parser/ast/expressions/IndexExpression";
import { InfixExpression } from "../../../parser/ast/expressions/InfixExpression";
import { IntegerLiteralExpression } from "../../../parser/ast/expressions/IntegerLiteral";
import { MemberExpression } from "../../../parser/ast/expressions/MemberExpression";
import { PointerMemberExpression } from "../../../parser/ast/expressions/PointerMemberExpression";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { Writer } from "../../writer/Writer";
import { baseScalar, sizeofType, wasmStoreOp } from "../emit.types";
import { emitGet, emitSet } from "./core";
import { emitExpression } from "./expression";
import { getPointerMemberData } from "./member";

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
    const varData = emitter.getVar(expression.left.left.tokenLiteral());
    if (!varData) {
      throw new Error(
        `[expression emitter] unknown array variable: "${expression.left.left.tokenLiteral()}"`,
      );
    }
    const memberType = baseScalar(varData.type);
    const memberSize = sizeofType(memberType);
    const storeOp = wasmStoreOp(memberType);
    const base = emitGet(varData.name, emitter);
    const val = emitExpression(expression.value, emitter);

    if (
      expression.left.index instanceof IntegerLiteralExpression &&
      expression.left.index.value === 0
    ) {
      writer.line(`(${storeOp} ${base} ${val})`);
    } else {
      const index = emitExpression(expression.left.index, emitter);
      writer.line(
        `(${storeOp} (i32.add ${base} (i32.mul ${index} (i32.const ${memberSize}))) ${val})`,
      );
    }
  } else if (
    expression.left instanceof MemberExpression ||
    expression.left instanceof PointerMemberExpression
  ) {
    if (expression.operator !== "=") {
      throw new Error("[expression emitter] compound assignment for members not implemented");
    }
    const { identData, memberData } = getPointerMemberData(expression.left, emitter);
    if (!memberData) {
      throw new Error("[expression emitter] struct member assignment requires a struct-typed base");
    }
    const t = memberData.type;
    const off = memberData.offset;
    const storeOp = wasmStoreOp(t);
    const base = emitGet(identData.name, emitter);
    const val = emitExpression(expression.value, emitter);
    writer.line(`(${storeOp} (i32.add ${base} (i32.const ${off})) ${val})`);
  } else {
    throw new Error(
      `[expression emitter] Assignment expression type: "${expression.left.toString()}" not supported`,
    );
  }

  return writer.toString();
}
