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
import { baseScalar, isUnsignedMapleInteger, valueTypeToWasm, wasmLoadOp } from "../emit.types";
import { emitAssignmentExpression } from "./assignment";
import { emitBinaryOp } from "./binary";
import { emitGet, emitNumberGet } from "./core";
import { emitFunctionCall } from "./function-call";
import { emitIndexExpression } from "./index";
import { resolveStructMember } from "./member";

function emitPrefixExpression(expression: PrefixExpression, emitter: ModuleEmitter): string {
  const right = expression.right;
  if (!right) {
    const t = expression.token;
    throw new MapleError("[expression emitter] prefix expression missing rhs", t.line, t.col);
  }

  const rhs = emitExpression(right, emitter);
  const mt = emitter.getExprType(right);
  if (mt === null) {
    const t = expression.token;
    throw new MapleError("unable to resolve prefix expression type", t.line, t.col);
  }
  const w = valueTypeToWasm(mt);
  switch (expression.operator) {
    case "!": {
      // wat2wasm rejects `i32.eqz` against i64/f32/f64; dispatch by lane.
      if (w === "i64") return `(i64.eqz ${rhs})`;
      if (w === "f32") return `(f32.eq ${rhs} (f32.const 0))`;
      if (w === "f64") return `(f64.eq ${rhs} (f64.const 0))`;
      return `(i32.eqz ${rhs})`;
    }
    case "-": {
      if (w === "f32") {
        return `(f32.neg ${rhs})`;
      }
      if (w === "f64") {
        return `(f64.neg ${rhs})`;
      }
      if (w === "i64") {
        return `(i64.sub (i64.const 0) ${rhs})`;
      }
      return `(i32.sub (i32.const 0) ${rhs})`;
    }
    case "~": {
      if (w === "i64") {
        return `(i64.xor ${rhs} (i64.const -1))`;
      }
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
  const mt = emitter.getExprType(expression.left);
  if (mt === null) {
    const t = expression.token;
    throw new MapleError("unable to resolve postfix expression type", t.line, t.col);
  }
  const w = valueTypeToWasm(mt);
  const delta = expression.operator === "++" ? 1 : -1;
  const deltaOp =
    w === "f32"
      ? `(f32.const ${delta})`
      : w === "f64"
        ? `(f64.const ${delta})`
        : w === "i64"
          ? `(i64.const ${delta})`
          : `(i32.const ${delta})`;
  const oneOp =
    w === "f32"
      ? "(f32.const 1)"
      : w === "f64"
        ? "(f64.const 1)"
        : w === "i64"
          ? "(i64.const 1)"
          : "(i32.const 1)";
  const updated = `(${w}.add ${getVal} ${deltaOp})`;
  const setOp = v.scope === "global" ? "global.set" : "local.set";

  if (expression.operator === "++") {
    return `(block (result ${w}) (${setOp} $${name} ${updated}) (${w}.sub ${emitGet(name, emitter)} ${oneOp}))`;
  }
  return `(block (result ${w}) (${setOp} $${name} ${updated}) (${w}.add ${emitGet(name, emitter)} ${oneOp}))`;
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
    const lane = expression.numericType === "i64" ? "i64" : "i32";
    writer.line(`(${lane}.const ${expression.constText(lane)})`);
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
    writer.line(
      `${emitNumberGet(expression.value, expression.numericType === "f64" ? "f64" : "f32")}`,
    );
    //
  } else if (expression instanceof StructLiteralExpression) {
    const t = expression.token;
    throw new MapleError(
      "[expression] struct literal must be assigned to a 'let' binding, not used as an inline value",
      t.line,
      t.col,
    );
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
    const { basePtr, memberData } = resolveStructMember(expression, emitter);
    const loadOp = wasmLoadOp(memberData.type);
    const off = emitNumberGet(memberData.offset, "i32");
    writer.append(`(${loadOp} (i32.add ${basePtr} ${off}))`);
  } else if (expression instanceof PrefixExpression) {
    writer.append(emitPrefixExpression(expression, emitter));
    //
  } else if (expression instanceof PostfixExpression) {
    writer.append(emitPostfixExpression(expression, emitter));
    //
  } else if (expression instanceof CastExpression) {
    const inner = emitExpression(expression.expr, emitter);
    const fromMt = emitter.getExprType(expression.expr);
    if (fromMt === null) {
      const t = expression.token;
      throw new MapleError("unable to resolve cast source type", t.line, t.col);
    }
    const fromW = valueTypeToWasm(fromMt);
    const toWasm = valueTypeToWasm(expression.targetType);
    const srcSign = isUnsignedMapleInteger(fromMt) ? "u" : "s";
    const dstSign = isUnsignedMapleInteger(expression.targetType) ? "u" : "s";
    let onLane: string;
    if (fromW === toWasm) {
      onLane = inner;
    } else if (fromW === "i32" && toWasm === "i64") {
      onLane = `(i64.extend_i32_${srcSign} ${inner})`;
    } else if (fromW === "i64" && toWasm === "i32") {
      onLane = `(i32.wrap_i64 ${inner})`;
    } else if (fromW === "i32" && toWasm === "f32") {
      onLane = `(f32.convert_i32_${srcSign} ${inner})`;
    } else if (fromW === "f32" && toWasm === "i32") {
      onLane = `(i32.trunc_f32_${dstSign} ${inner})`;
    } else if (fromW === "i32" && toWasm === "f64") {
      onLane = `(f64.convert_i32_${srcSign} ${inner})`;
    } else if (fromW === "f64" && toWasm === "i32") {
      onLane = `(i32.trunc_f64_${dstSign} ${inner})`;
    } else if (fromW === "f32" && toWasm === "f64") {
      onLane = `(f64.promote_f32 ${inner})`;
    } else if (fromW === "f64" && toWasm === "f32") {
      onLane = `(f32.demote_f64 ${inner})`;
    } else if (fromW === "i64" && toWasm === "f64") {
      onLane = `(f64.convert_i64_${srcSign} ${inner})`;
    } else if (fromW === "f64" && toWasm === "i64") {
      onLane = `(i64.trunc_f64_${dstSign} ${inner})`;
    } else if (fromW === "f32" && toWasm === "i64") {
      onLane = `(i64.trunc_f32_${dstSign} ${inner})`;
    } else if (fromW === "i64" && toWasm === "f32") {
      onLane = `(f32.convert_i64_${srcSign} ${inner})`;
    } else {
      onLane = inner;
    }
    // After the lane-conversion above, narrow integer target types still
    // hold their value on the i32 lane and need an explicit mask (unsigned)
    // or sign-extend (signed) so reading the value back as i32 doesn't see
    // the higher bits.
    if (toWasm === "i32") {
      const base = baseScalar(expression.targetType);
      if (base === "u8") onLane = `(i32.and ${onLane} (i32.const 0xFF))`;
      else if (base === "u16") onLane = `(i32.and ${onLane} (i32.const 0xFFFF))`;
      else if (base === "i8") onLane = `(i32.extend8_s ${onLane})`;
      else if (base === "i16") onLane = `(i32.extend16_s ${onLane})`;
    }
    writer.line(onLane);
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
