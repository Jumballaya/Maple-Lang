import { AssignmentExpression } from "../../../parser/ast/expressions/AssignmentExpression.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { Writer } from "../../writer/Writer.js";
import { wasmStoreOp } from "../emit.types.js";
import { emitGet, emitSet } from "./core.js";
import { emitExpression } from "./expression.js";
import { getPointerMemberData } from "./member.js";

export function emitAssignmentExpression(
  expression: AssignmentExpression,
  emitter: ModuleEmitter
): string {
  const writer = new Writer();
  switch (expression.identifier.type) {
    case "identifier": {
      const name = expression.identifier.value;
      writer.line(emitSet(name, expression.expression, emitter));
      break;
    }

    case "member":
    case "pointer_member": {
      const { identData, memberData } = getPointerMemberData(
        expression.identifier,
        emitter
      );
      if (memberData) {
        const t = memberData.type;
        const off = memberData.offset;
        const storeOp = wasmStoreOp(t);
        const base = emitGet(identData.name, emitter);
        const val = emitExpression(expression.expression, emitter);
        writer.line(`(${storeOp} (i32.add ${base} (i32.const ${off})) ${val})`);
      } else {
        // no member data means it is a local flattened variable instead of an real struct pointer
        writer.line(emitSet(identData.name, expression.expression, emitter));
      }
      break;
    }

    default: {
      throw new Error(
        `[expression emitter] Assignment expression type: "${expression.identifier.type}" not supported`
      );
    }
  }
  return writer.toString();
}
