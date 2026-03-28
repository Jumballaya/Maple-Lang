import type { AssignmentExpression } from "../../../parser/ast/expressions/AssignmentExpression.js";
import { Identifier } from "../../../parser/ast/expressions/Identifier.js";
import { InfixExpression } from "../../../parser/ast/expressions/InfixExpression.js";
import { MemberExpression } from "../../../parser/ast/expressions/MemberExpression.js";
import { PointerMemberExpression } from "../../../parser/ast/expressions/PointerMemberExpression.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { Writer } from "../../writer/Writer.js";
import { wasmStoreOp } from "../emit.types.js";
import { emitGet, emitSet } from "./core.js";
import { emitExpression } from "./expression.js";
import { getPointerMemberData } from "./member.js";

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
  } else if (
    expression.left instanceof MemberExpression ||
    expression.left instanceof PointerMemberExpression
  ) {
    if (expression.operator !== "=") {
      throw new Error("[expression emitter] compound assignment for members not implemented");
    }
    const { identData, memberData } = getPointerMemberData(expression.left, emitter);
    if (memberData) {
      const t = memberData.type;
      const off = memberData.offset;
      const storeOp = wasmStoreOp(t);
      const base = emitGet(identData.name, emitter);
      const val = emitExpression(expression.value, emitter);
      writer.line(`(${storeOp} (i32.add ${base} (i32.const ${off})) ${val})`);
    } else {
      // no member data means it is a local flattened variable instead of an real struct pointer
      writer.line(emitSet(identData.name, expression.value, emitter));
    }
  } else {
    throw new Error(
      `[expression emitter] Assignment expression type: "${expression.left.toString()}" not supported`,
    );
  }

  return writer.toString();
}
