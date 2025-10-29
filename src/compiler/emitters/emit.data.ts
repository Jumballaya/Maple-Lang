import { ArrayLiteralExpression } from "../../parser/ast/expressions/ArrayLiteralExpression.js";
import { AssignmentExpression } from "../../parser/ast/expressions/AssignmentExpression.js";
import { CallExpression } from "../../parser/ast/expressions/CallExpression.js";
import { StringLiteralExpression } from "../../parser/ast/expressions/StringLiteral.js";
import { StructLiteralExpression } from "../../parser/ast/expressions/StructLiteralExpression.js";
import { BlockStatement } from "../../parser/ast/statements/BlockStatement.js";
import { ExpressionStatement } from "../../parser/ast/statements/ExpressionStatement.js";
import { ForStatement } from "../../parser/ast/statements/ForStatement.js";
import { FunctionStatement } from "../../parser/ast/statements/FunctionStatement.js";
import { IfStatement } from "../../parser/ast/statements/IfStatement.js";
import { LetStatement } from "../../parser/ast/statements/LetStatement.js";
import { WhileStatement } from "../../parser/ast/statements/WhileStatement.js";
import { ASTStatement } from "../../parser/ast/types/ast.type.js";
import type { ModuleBuilder } from "../ModuleBuilder.js";
import type { ModuleEmitter } from "../ModuleEmitter.js";
import { baseScalar, sizeofType } from "./emit.types.js";

export function extractGlobalData(stmt: ASTStatement, builder: ModuleBuilder) {
  if (stmt instanceof BlockStatement) {
    for (const st of stmt.statements) {
      extractGlobalData(st, builder);
    }
    return;
  }
  if (stmt instanceof FunctionStatement) {
    extractGlobalData(stmt.fnExpr.body, builder);
    return;
  }
  if (stmt instanceof ForStatement) {
    extractGlobalData(stmt.loopBody, builder);
    return;
  }
  if (stmt instanceof IfStatement) {
    extractGlobalData(stmt.thenBlock, builder);
    if (stmt.elseBlock) {
      extractGlobalData(stmt.elseBlock, builder);
    }
    return;
  }
  if (stmt instanceof WhileStatement) {
    extractGlobalData(stmt.loopBody, builder);
    return;
  }
  if (stmt instanceof ExpressionStatement) {
    if (stmt.expression instanceof AssignmentExpression) {
      const expr = stmt.expression;
      if (expr.value instanceof StringLiteralExpression) {
        extractStringLiteral(expr.value, builder);
      }
      if (expr.value instanceof ArrayLiteralExpression) {
        extractArrayLiteral(expr.value, builder);
      }
      if (expr.value instanceof StructLiteralExpression) {
        extractStructLiteral(expr.value, builder);
      }
    }
    if (stmt.expression instanceof CallExpression) {
      const expr = stmt.expression;
      for (const p of expr.args) {
        if (p instanceof StringLiteralExpression) {
          extractStringLiteral(p, builder);
        }
        if (p instanceof ArrayLiteralExpression) {
          extractArrayLiteral(p, builder);
        }
        if (p instanceof StructLiteralExpression) {
          extractStructLiteral(p, builder);
        }
      }
    }
    if (stmt.expression instanceof StringLiteralExpression) {
      extractStringLiteral(stmt.expression, builder);
    }
    if (stmt.expression instanceof ArrayLiteralExpression) {
      extractArrayLiteral(stmt.expression, builder);
    }
    if (stmt.expression instanceof StructLiteralExpression) {
      extractStructLiteral(stmt.expression, builder);
    }
    return;
  }
  if (stmt instanceof LetStatement) {
    if (stmt.expression instanceof StringLiteralExpression) {
      extractStringLiteral(stmt.expression, builder);
    }
    if (stmt.expression instanceof ArrayLiteralExpression) {
      extractArrayLiteral(stmt.expression, builder);
    }
    if (stmt.expression instanceof StructLiteralExpression) {
      extractStructLiteral(stmt.expression, builder);
    }
    return;
  }
}

function extractArrayLiteral(
  expr: ArrayLiteralExpression,
  builder: ModuleBuilder
) {
  const memberType = baseScalar(expr.memberType);
  const memberSize = sizeofType(memberType);
  const total = expr.elements.length * memberSize;
  const addr = builder.dataAlloc(total);
  builder.addBytes(numToLittleEndian(expr.elements, expr.memberType), addr);
  expr.location = addr;
}

function extractStringLiteral(
  expr: StringLiteralExpression,
  builder: ModuleBuilder
) {
  const lit = expr.value;
  const len = lit.length;

  //
  //    struct string {
  //      len: i32,
  //      data: *u8,
  //    }
  //
  const charPtr = builder.internString(lit); // data for chars
  const header = numToLittleEndian([len, charPtr], "i32"); // [len, ptr]
  const hdrAddr = builder.addBytes(header); // auto-alloc header
  expr.location = hdrAddr; // string pointer points to header
}

function extractStructLiteral(
  expr: StructLiteralExpression,
  builder: ModuleBuilder
) {
  const sd = builder.getStruct(expr.tokenLiteral());
  if (!sd) {
    throw new Error(`struct not found: ${expr.tokenLiteral()}`);
  }
  for (const f of Object.keys(expr.table)) {
    if (!sd.members[f]) {
      throw new Error(`struct "${sd.name}" has no member "${f}"`);
    }
  }

  let encoded = "";
  for (const [, value] of Object.entries(expr.table)) {
    if (typeof value !== "number") {
      throw new Error(
        "[struct literal member] non-number literal values not supported"
      );
    }
    encoded += numToLittleEndian(
      [value],
      Number.isInteger(value) ? "i32" : "f32"
    );
  }

  const addr = builder.addBytes(encoded);
  expr.location = addr;
}

function numToLittleEndian(ns: number[], type: string) {
  const baseType = baseScalar(type);
  const byteSize = sizeofType(baseType);
  const buffer = new ArrayBuffer(byteSize * ns.length);

  if (baseType === "i32") {
    const i32 = new Int32Array(buffer);
    i32.set(ns, 0);
  } else if (baseType === "f32") {
    const f32 = new Float32Array(buffer);
    f32.set(ns, 0);
  } else {
    throw new Error(`unsupported type: "${baseType}"`);
  }

  return Array.from(new Uint8Array(buffer)).reduce((str, b) => {
    return `${str}\\${b.toString(16).padStart(2, "0")}`;
  }, "");
}

export function alignup(value: number, alignment = 4) {
  if (alignment <= 0) {
    throw new Error(`Alignment must be a positive integer`);
  }
  if (value % alignment === 0) {
    return value;
  }
  return value + (alignment - (value % alignment));
}

function defStructLocalFields(
  emitter: ModuleEmitter,
  base: string,
  structName: string
) {
  const sd = emitter.getStruct(structName);
  if (!sd) throw new Error(`unknown struct: "${structName}"`);
  for (const [m, md] of Object.entries(sd.members)) {
    emitter.defLocal({ name: `${base}_${m}`, type: md.type, scope: "local" });
  }
}

export function extractLocals(s: ASTStatement, builder: ModuleEmitter) {
  if (s instanceof FunctionStatement) {
    extractLocals(s.fnExpr.body, builder);
    return;
  }
  if (s instanceof LetStatement) {
    if (s.expression instanceof StructLiteralExpression) {
      defStructLocalFields(
        builder,
        s.identifier.tokenLiteral(),
        s.expression.name
      );
      return;
    }
    builder.defLocal({
      name: s.identifier.tokenLiteral(),
      type: s.typeAnnotation,
      scope: "local",
    });
    return;
  }
  if (s instanceof BlockStatement) {
    for (const st of s.statements) {
      extractLocals(st, builder);
    }
    return;
  }
  if (s instanceof IfStatement) {
    extractLocals(s.thenBlock, builder);
    if (s.elseBlock) {
      extractLocals(s.elseBlock, builder);
    }
    return;
  }
  if (s instanceof WhileStatement) {
    extractLocals(s.loopBody, builder);
    return;
  }
  if (s instanceof ForStatement) {
    const init = s.initBlock;
    if (init.expression instanceof StructLiteralExpression) {
      defStructLocalFields(
        builder,
        init.identifier.tokenLiteral(),
        init.expression.name
      );
    } else {
      builder.defLocal({
        name: s.initBlock.identifier.tokenLiteral(),
        type: s.initBlock.typeAnnotation,
        scope: "local",
      });
    }
    extractLocals(s.loopBody, builder);
    return;
  }
}
