import { ArrayLiteralExpression } from "../../../parser/ast/expressions/ArrayLiteralExpression";
import { AssignmentExpression } from "../../../parser/ast/expressions/AssignmentExpression";
import { BooleanLiteralExpression } from "../../../parser/ast/expressions/BooleanLiteralExpression";
import { CallExpression } from "../../../parser/ast/expressions/CallExpression";
import { CastExpression } from "../../../parser/ast/expressions/CastExpression";
import { CharLiteralExpression } from "../../../parser/ast/expressions/CharLiteralExpression";
import { FloatLiteralExpression } from "../../../parser/ast/expressions/FloatLiteralExpression";
import { Identifier } from "../../../parser/ast/expressions/Identifier";
import { IndexExpression } from "../../../parser/ast/expressions/IndexExpression";
import { InfixExpression } from "../../../parser/ast/expressions/InfixExpression";
import { IntegerLiteralExpression } from "../../../parser/ast/expressions/IntegerLiteral";
import { MemberExpression } from "../../../parser/ast/expressions/MemberExpression";
import { PointerMemberExpression } from "../../../parser/ast/expressions/PointerMemberExpression";
import { PostfixExpression } from "../../../parser/ast/expressions/PostfixExpression";
import { PrefixExpression } from "../../../parser/ast/expressions/PrefixExpression";
import { StringLiteralExpression } from "../../../parser/ast/expressions/StringLiteral";
import { StructLiteralExpression } from "../../../parser/ast/expressions/StructLiteralExpression";
import type { ASTExpression } from "../../../parser/ast/types/ast.type";
import { MapleError } from "../../errors";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { Writer } from "../../writer/Writer";
import { valueTypeToWasm, wasmLoadOp } from "../emit.types";
import { emitAssignmentExpression } from "./assignment";
import { emitBinaryOp } from "./binary";
import { emitGet, emitNumberGet } from "./core";
import { emitFunctionCall } from "./function-call";
import { emitIndexExpression } from "./index";
import { getPointerMemberData } from "./member";

function emitPrefixExpression(expression: PrefixExpression, emitter: ModuleEmitter): string {
  const right = expression.right;
  if (!right) {
    const t = expression.token;
    throw new MapleError("[expression emitter] prefix expression missing rhs", t.line, t.col);
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
      const t = expression.token;
      throw new MapleError(
        `[expression emitter] unsupported prefix operator "${expression.operator}"`,
        t.line,
        t.col,
      );
    }
  }
}

function emitPostfixExpression(expression: PostfixExpression, emitter: ModuleEmitter): string {
  if (!(expression.left instanceof Identifier)) {
    const t = expression.token;
    throw new MapleError("[expression emitter] postfix only supports identifiers", t.line, t.col);
  }
  if (expression.operator !== "++" && expression.operator !== "--") {
    const t = expression.token;
    throw new MapleError(
      `[expression emitter] unsupported postfix operator "${expression.operator}"`,
      t.line,
      t.col,
    );
  }

  const name = expression.left.tokenLiteral();
  const v = emitter.getVar(name);
  if (!v) {
    const t = expression.left.token;
    throw new MapleError(`variable not found: "${name}"`, t.line, t.col);
  }
  if (v.scope === "memory") {
    const t = expression.token;
    throw new MapleError(
      "[expression emitter] postfix on memory variables not implemented",
      t.line,
      t.col,
    );
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
    if (!memberData) {
      const t = expression.token;
      throw new MapleError(
        "[expression emitter] struct member access requires a struct-typed base",
        t.line,
        t.col,
      );
    }
    const loadOp = wasmLoadOp(memberData.type);
    const offset = memberData.offset;
    const addr = emitGet(identData.name, emitter);
    const val = emitNumberGet(offset, "i32");
    writer.append(`(${loadOp} (i32.add ${addr} ${val}))`);
  } else if (expression instanceof PrefixExpression) {
    writer.append(emitPrefixExpression(expression, emitter));
    //
  } else if (expression instanceof PostfixExpression) {
    writer.append(emitPostfixExpression(expression, emitter));
    //
  } else if (expression instanceof CastExpression) {
    const inner = emitExpression(expression.expr, emitter);
    const from = emitter.getExprType(expression.expr);
    const toWasm = valueTypeToWasm(expression.targetType);
    if (from === "i32" && toWasm === "f32") {
      writer.line(`(f32.convert_i32_s ${inner})`);
    } else if (from === "f32" && toWasm === "i32") {
      writer.line(`(i32.trunc_f32_s ${inner})`);
    } else {
      writer.line(inner); // same WASM type (e.g. i32 → u8, i32 → i16): no-op
    }
    //
  } else {
    const t = expression.token;
    throw new MapleError(
      `[expression emitter] "${expression.constructor.name}" emit not implemented`,
      t.line,
      t.col,
    );
  }

  return writer.toString();
}
