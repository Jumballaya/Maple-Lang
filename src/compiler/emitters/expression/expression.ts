import { ArrayLiteralExpression } from "../../../parser/ast/expressions/ArrayLiteralExpression.js";
import { AssignmentExpression } from "../../../parser/ast/expressions/AssignmentExpression.js";
import { BooleanLiteralExpression } from "../../../parser/ast/expressions/BooleanLiteralExpression.js";
import { CallExpression } from "../../../parser/ast/expressions/CallExpression.js";
import { CharLiteralExpression } from "../../../parser/ast/expressions/CharLiteralExpression.js";
import { FloatLiteralExpression } from "../../../parser/ast/expressions/FloatLiteralExpression.js";
import { Identifier } from "../../../parser/ast/expressions/Identifier.js";
import { IndexExpression } from "../../../parser/ast/expressions/IndexExpression.js";
import { InfixExpression } from "../../../parser/ast/expressions/InfixExpression.js";
import { IntegerLiteralExpression } from "../../../parser/ast/expressions/IntegerLiteral.js";
import { MemberExpression } from "../../../parser/ast/expressions/MemberExpression.js";
import { PointerMemberExpression } from "../../../parser/ast/expressions/PointerMemberExpression.js";
import { PostfixExpression } from "../../../parser/ast/expressions/PostfixExpression.js";
import { PrefixExpression } from "../../../parser/ast/expressions/PrefixExpression.js";
import { StringLiteralExpression } from "../../../parser/ast/expressions/StringLiteral.js";
import { StructLiteralExpression } from "../../../parser/ast/expressions/StructLiteralExpression.js";
import type { ASTExpression } from "../../../parser/ast/types/ast.type.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { Writer } from "../../writer/Writer.js";
import { wasmLoadOp } from "../emit.types.js";
import { emitAssignmentExpression } from "./assignment.js";
import { emitBinaryOp } from "./binary.js";
import { emitGet, emitNumberGet } from "./core.js";
import { emitFunctionCall } from "./function-call.js";
import { emitIndexExpression } from "./index.js";
import { getPointerMemberData } from "./member.js";

function emitPrefixExpression(expression: PrefixExpression, emitter: ModuleEmitter): string {
  const right = expression.right;
  if (!right) {
    throw new Error("[expression emitter] prefix expression missing rhs");
  }

  const rhs = emitExpression(right, emitter);
  switch (expression.operator) {
    case "!": {
      return `(i32.eqz ${rhs})`;
    }
    case "-": {
      const t = emitter.getExprType(right);
      if (t === "f32") {
        return `(f32.neg ${rhs})`;
      }
      return `(i32.sub (i32.const 0) ${rhs})`;
    }
    case "~": {
      return `(i32.xor ${rhs} (i32.const -1))`;
    }
    default: {
      throw new Error(`[expression emitter] unsupported prefix operator "${expression.operator}"`);
    }
  }
}

function emitPostfixExpression(expression: PostfixExpression, emitter: ModuleEmitter): string {
  if (!(expression.left instanceof Identifier)) {
    throw new Error("[expression emitter] postfix only supports identifiers");
  }
  if (expression.operator !== "++" && expression.operator !== "--") {
    throw new Error(`[expression emitter] unsupported postfix operator "${expression.operator}"`);
  }

  const name = expression.left.tokenLiteral();
  const v = emitter.getVar(name);
  if (!v) {
    throw new Error(`variable not found: "${name}"`);
  }
  if (v.scope === "memory") {
    throw new Error("[expression emitter] postfix on memory variables not implemented");
  }

  const getVal = emitGet(name, emitter);
  const delta = expression.operator === "++" ? 1 : -1;
  const updated = `(i32.add ${getVal} (i32.const ${delta}))`;
  const setOp = v.scope === "global" ? "global.set" : "local.set";

  if (expression.operator === "++") {
    return `(block (result i32) (${setOp} $${name} ${updated}) (i32.sub ${emitGet(name, emitter)} (i32.const 1)))`;
  }
  return `(block (result i32) (${setOp} $${name} ${updated}) (i32.add ${emitGet(name, emitter)} (i32.const 1)))`;
}

export function emitExpression(expression: ASTExpression, emitter: ModuleEmitter): string {
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
    writer.append(emitPrefixExpression(expression, emitter));
    //
  } else if (expression instanceof PostfixExpression) {
    writer.append(emitPostfixExpression(expression, emitter));
    //
  } else {
    throw new Error(`[expression emitter] "${expression.constructor}" emit not implemented`);
  }

  return writer.toString();
}
