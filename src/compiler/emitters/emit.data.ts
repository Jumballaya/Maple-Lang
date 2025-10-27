import { ArrayLiteralExpression } from "../../parser/ast/expressions/ArrayLiteralExpression.js";
import { StringLiteralExpression } from "../../parser/ast/expressions/StringLiteral.js";
import { StructLiteralExpression } from "../../parser/ast/expressions/StructLiteralExpression.js";
import { ASTStatement } from "../../parser/ast/types/ast.type.js";
import type { ModuleBuilder } from "../ModuleBuilder.js";
import type { ModuleEmitter } from "../ModuleEmitter.js";
import { baseScalar, sizeofType } from "./emit.types.js";

export function extractGlobalData(stmt: ASTStatement, builder: ModuleBuilder) {
  switch (stmt.type) {
    case "block": {
      for (const st of stmt.body) {
        extractGlobalData(st, builder);
      }
      break;
    }
    case "function": {
      extractGlobalData(stmt.body, builder);
      break;
    }
    case "for": {
      extractGlobalData(stmt.body, builder);
      break;
    }
    case "if": {
      extractGlobalData(stmt.thenBlock, builder);
      if (stmt.elseBlock) {
        extractGlobalData(stmt.elseBlock, builder);
      }
      break;
    }
    case "while": {
      extractGlobalData(stmt.body, builder);
      break;
    }
    case "expression": {
      if (stmt.expression.type === "assignment") {
        const expr = stmt.expression;
        if (expr.expression.type === "string_literal") {
          extractStringLiteral(expr.expression, builder);
        }
        if (expr.expression.type === "array_literal") {
          extractArrayLiteral(expr.expression, builder);
        }
        if (expr.expression.type === "struct_literal") {
          extractStructLiteral(expr.expression, builder);
        }
      }
      if (stmt.expression.type === "function_call") {
        const expr = stmt.expression;
        for (const p of expr.params) {
          if (p.type === "string_literal") {
            extractStringLiteral(p, builder);
          }
          if (p.type === "array_literal") {
            extractArrayLiteral(p, builder);
          }
          if (p.type === "struct_literal") {
            extractStructLiteral(p, builder);
          }
        }
      }
      if (stmt.expression.type === "string_literal") {
        extractStringLiteral(stmt.expression, builder);
      }
      if (stmt.expression.type === "array_literal") {
        extractArrayLiteral(stmt.expression, builder);
      }
      if (stmt.expression.type === "struct_literal") {
        extractStructLiteral(stmt.expression, builder);
      }
      break;
    }
    case "let": {
      if (stmt.expression.type === "string_literal") {
        extractStringLiteral(stmt.expression, builder);
      }
      if (stmt.expression.type === "array_literal") {
        extractArrayLiteral(stmt.expression, builder);
      }
      if (stmt.expression.type === "struct_literal") {
        extractStructLiteral(stmt.expression, builder);
      }
      break;
    }
  }
}

function extractArrayLiteral(
  expr: ArrayLiteralExpression,
  builder: ModuleBuilder
) {
  const memberType = baseScalar(expr.memberType);
  const memberSize = sizeofType(memberType);
  const total = expr.value.length * memberSize;
  const addr = builder.dataAlloc(total);
  builder.addBytes(numToLittleEndian(expr.value, expr.memberType), addr);
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
  const sd = builder.getStruct(expr.struct);
  if (!sd) {
    throw new Error(`struct not found: ${expr.struct}`);
  }
  for (const f of Object.keys(expr.values)) {
    if (!sd.members[f]) {
      throw new Error(`struct "${sd.name}" has no member "${f}"`);
    }
  }

  let encoded = "";
  for (const [, value] of Object.entries(expr.values)) {
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
  const byteSize = sizeofType(baseScalar(type));
  const buffer = new ArrayBuffer(byteSize * ns.length);

  if (type === "i32") {
    const i32 = new Int32Array(buffer);
    i32.set(ns, 0);
  } else if (type === "f32") {
    const f32 = new Float32Array(buffer);
    f32.set(ns, 0);
  } else {
    throw new Error(`unsupported type: "${type}"`);
  }

  return Array.from(new Uint8Array(buffer)).reduce((str, b) => {
    return `${str}\\${b.toString(16).padStart(2, "0")}`;
  }, "");
}

export function alignup(value: number, alignment = 8) {
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
  switch (s.type) {
    case "function": {
      extractLocals(s.body, builder);
      break;
    }
    case "let": {
      if (s.expression.type === "struct_literal") {
        defStructLocalFields(builder, s.identifier, s.expression.struct);
        break;
      }
      builder.defLocal({
        name: s.identifier,
        type: s.typeAnnotation,
        scope: "local",
      });
      break;
    }
    case "block": {
      for (const st of s.body) {
        extractLocals(st, builder);
      }
      break;
    }
    case "if": {
      extractLocals(s.thenBlock, builder);
      if (s.elseBlock) {
        extractLocals(s.elseBlock, builder);
      }
      break;
    }
    case "while": {
      extractLocals(s.body, builder);
      break;
    }
    case "for": {
      const init = s.initBlock;
      if (init.expression.type === "struct_literal") {
        defStructLocalFields(builder, init.identifier, init.expression.struct);
      } else {
        builder.defLocal({
          name: s.initBlock.identifier,
          type: s.initBlock.typeAnnotation,
          scope: "local",
        });
      }
      extractLocals(s.body, builder);
      break;
    }
  }
}
