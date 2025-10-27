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

export function emitExpression(
  expression: ASTExpression,
  emitter: ModuleEmitter
): string {
  const writer = new Writer();
  const { type } = expression;
  switch (type) {
    case "identifier": {
      writer.line(emitGet(expression.value, emitter));
      break;
    }
    case "binary": {
      writer.line(emitBinaryOp(expression, emitter));
      break;
    }
    case "function_call": {
      writer.line(emitFunctionCall(expression, emitter));
      break;
    }
    case "integer_literal": {
      writer.line(emitNumberGet(expression.value, "i32"));
      break;
    }
    case "bool_literal": {
      writer.line(emitNumberGet(expression.value ? 1 : 0, "i32"));
      break;
    }
    case "char_literal": {
      writer.line(emitNumberGet(expression.value, "i32"));
      break;
    }
    case "string_literal": {
      // Strings are treated as pointers to the location in memory
      writer.line(`${emitNumberGet(expression.location, "i32")}`);
      break;
    }
    case "array_literal": {
      writer.line(`${emitNumberGet(expression.location, "i32")}`);
      break;
    }
    case "float_literal": {
      writer.line(`${emitNumberGet(expression.value, "f32")}`);
      break;
    }
    case "struct_literal": {
      // @TODO: this should return the pointer to the created struct
      break;
    }
    case "assignment": {
      writer.line(`${emitAssignmentExpression(expression, emitter)}`);
      break;
    }

    case "index": {
      writer.line(`${emitIndexExpression(expression, emitter)}`);
      break;
    }

    case "member":
    case "pointer_member": {
      const { memberData, identData } = getPointerMemberData(
        expression,
        emitter
      );
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
      break;
    }

    case "prefix": {
      writer.append(`(i32.eqz ${emitExpression(expression.right, emitter)})`);
      break;
    }

    default: {
      throw new Error(`[expression emitter] "${type}" emit not implemented`);
    }
  }
  return writer.toString();
}
