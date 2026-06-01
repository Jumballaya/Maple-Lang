import { ArrayLiteralExpression } from "../../parser/ast/expressions/ArrayLiteralExpression";
import { AssignmentExpression } from "../../parser/ast/expressions/AssignmentExpression";
import { BooleanLiteralExpression } from "../../parser/ast/expressions/BooleanLiteralExpression";
import { CallExpression } from "../../parser/ast/expressions/CallExpression";
import { FloatLiteralExpression } from "../../parser/ast/expressions/FloatLiteralExpression";
import { IntegerLiteralExpression } from "../../parser/ast/expressions/IntegerLiteral";
import { StringLiteralExpression } from "../../parser/ast/expressions/StringLiteral";
import { StructLiteralExpression } from "../../parser/ast/expressions/StructLiteralExpression";
import { BlockStatement } from "../../parser/ast/statements/BlockStatement";
import { ExpressionStatement } from "../../parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../../parser/ast/statements/ForStatement";
import { FunctionStatement } from "../../parser/ast/statements/FunctionStatement";
import { IfStatement } from "../../parser/ast/statements/IfStatement";
import { LetStatement } from "../../parser/ast/statements/LetStatement";
import { SwitchStatement } from "../../parser/ast/statements/SwitchStatement";
import { TuplePattern } from "../../parser/ast/statements/TuplePattern";
import { WhileStatement } from "../../parser/ast/statements/WhileStatement";
import type { ASTStatement } from "../../parser/ast/types/ast.type";
import type { ModuleBuilder } from "../ModuleBuilder";
import type { ModuleEmitter } from "../ModuleEmitter";
import { baseScalar, sizeofType } from "./emit.types";

export function extractGlobalData(
  stmt: ASTStatement,
  builder: ModuleBuilder,
  insideFunction = false,
) {
  if (stmt instanceof BlockStatement) {
    for (const st of stmt.statements) {
      extractGlobalData(st, builder, insideFunction);
    }
    return;
  }
  if (stmt instanceof FunctionStatement) {
    extractGlobalData(stmt.fnExpr.body, builder, true);
    return;
  }
  if (stmt instanceof ForStatement) {
    extractGlobalData(stmt.loopBody, builder, insideFunction);
    return;
  }
  if (stmt instanceof IfStatement) {
    extractGlobalData(stmt.thenBlock, builder, insideFunction);
    if (stmt.elseBlock) {
      extractGlobalData(stmt.elseBlock, builder, insideFunction);
    }
    return;
  }
  if (stmt instanceof WhileStatement) {
    extractGlobalData(stmt.loopBody, builder, insideFunction);
    return;
  }
  if (stmt instanceof SwitchStatement) {
    for (const c of stmt.cases) {
      extractGlobalData(c.body, builder, insideFunction);
    }
    if (stmt.default) {
      extractGlobalData(stmt.default, builder, insideFunction);
    }
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
      if (expr.value instanceof StructLiteralExpression && !insideFunction) {
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
        if (p instanceof StructLiteralExpression && !insideFunction) {
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
    if (stmt.expression instanceof StructLiteralExpression && !insideFunction) {
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
    if (stmt.expression instanceof StructLiteralExpression && !insideFunction) {
      extractStructLiteral(stmt.expression, builder);
    }
    return;
  }
}

function extractArrayLiteral(expr: ArrayLiteralExpression, builder: ModuleBuilder) {
  const memberType = baseScalar(expr.memberType);
  const memberSize = sizeofType(memberType);
  const total = expr.elements.length * memberSize;
  const addr = builder.dataAlloc(total);
  builder.addBytes(numToLittleEndian(expr.elements, expr.memberType), addr);
  expr.location = addr;
}

function extractStringLiteral(expr: StringLiteralExpression, builder: ModuleBuilder) {
  const lit = expr.value;
  const utf8 = new TextEncoder().encode(lit);
  const len = utf8.length;

  //
  //    struct string {
  //      len: i32,
  //      data: *u8,
  //    }
  //
  // Pad raw bytes to a 4-byte boundary with explicit \00 bytes so the emitted
  // data segment covers the full allocation stride. Without this, wasm-ld packs
  // data segments contiguously and eliminates the implicit gap, misaligning the
  // header address that the code has already hard-coded.
  const paddedLen = alignup(len, 4);
  let rawBytes = Array.from(utf8).reduce((acc, b) => {
    return `${acc}\\${b.toString(16).padStart(2, "0")}`;
  }, "");
  for (let i = len; i < paddedLen; i++) {
    rawBytes += "\\00";
  }

  const charPtr = builder.addBytes(rawBytes, undefined, 4); // paddedLen bytes, align 4
  const header = numToLittleEndian([len, charPtr], "i32"); // [len, ptr]
  const hdrAddr = builder.addBytes(header, undefined, 4); // header immediately follows
  expr.location = hdrAddr; // string pointer points to header
}

function extractStructLiteral(expr: StructLiteralExpression, builder: ModuleBuilder) {
  const sd = builder.getStruct(expr.name);
  if (!sd) {
    const addr = builder.dataAlloc(0);
    expr.location = addr;
    return;
  }

  const addr = builder.dataAlloc(sd.size, 8);
  let encoded = "";
  const members = Object.values(sd.members).sort((a, b) => a.offset - b.offset);
  for (const member of members) {
    const value = expr.members[member.name];
    if (
      value instanceof IntegerLiteralExpression ||
      value instanceof FloatLiteralExpression ||
      value instanceof BooleanLiteralExpression
    ) {
      const num = typeof value.value === "boolean" ? (value.value ? 1 : 0) : value.value;
      encoded += numToLittleEndian([num], member.type);
    } else {
      encoded += numToLittleEndian([0], member.type);
      if (value) {
        builder.deferredGlobalInits.push({
          baseAddr: addr,
          offset: member.offset,
          fieldType: member.type,
          expr: value,
        });
      }
    }
  }

  builder.addBytes(encoded, addr);
  expr.location = addr;
}

function numToLittleEndian(ns: number[], type: string) {
  const baseType = baseScalar(type);
  const byteSize = sizeofType(baseType);
  const buffer = new ArrayBuffer(byteSize * ns.length);

  if (baseType === "i32" || baseType === "u32") {
    const i32 = new Int32Array(buffer);
    i32.set(ns, 0);
  } else if (baseType === "f32") {
    const f32 = new Float32Array(buffer);
    f32.set(ns, 0);
  } else if (baseType === "i64" || baseType === "u64") {
    const i64 = new BigInt64Array(buffer);
    i64.set(
      ns.map((n) => BigInt(Math.trunc(n))),
      0,
    );
  } else if (baseType === "f64") {
    const f64 = new Float64Array(buffer);
    f64.set(ns, 0);
  } else if (baseType === "i8" || baseType === "u8" || baseType === "bool") {
    const u8 = new Uint8Array(buffer);
    u8.set(
      ns.map((n) => Math.trunc(n) & 0xff),
      0,
    );
  } else if (baseType === "i16" || baseType === "u16") {
    const view = new DataView(buffer);
    for (let i = 0; i < ns.length; i++) {
      view.setInt16(i * 2, Math.trunc(ns[i]!), true);
    }
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

export function buildLocalStructFrame(
  s: ASTStatement,
  emitter: ModuleEmitter,
): { totalSize: number; offsets: Record<string, number> } {
  let total = 0;
  const offsets: Record<string, number> = {};

  function recordStructLocal(nameToken: string, structName: string): void {
    const sd = emitter.getStruct(structName);
    if (!sd) throw new Error(`unknown struct: "${structName}"`);
    const name = nameToken;
    offsets[name] = total;
    total += sd.size;
  }

  function walk(stmt: ASTStatement): void {
    if (stmt instanceof FunctionStatement) {
      return;
    }
    if (stmt instanceof LetStatement) {
      if (stmt.pattern instanceof TuplePattern) {
        return;
      }
      if (stmt.expression instanceof StructLiteralExpression) {
        recordStructLocal(stmt.identifier.tokenLiteral(), stmt.expression.name);
      }
      return;
    }
    if (stmt instanceof BlockStatement) {
      for (const st of stmt.statements) {
        walk(st);
      }
      return;
    }
    if (stmt instanceof IfStatement) {
      walk(stmt.thenBlock);
      if (stmt.elseBlock) {
        walk(stmt.elseBlock);
      }
      return;
    }
    if (stmt instanceof WhileStatement) {
      walk(stmt.loopBody);
      return;
    }
    if (stmt instanceof ForStatement) {
      const init = stmt.initBlock;
      if (init.expression instanceof StructLiteralExpression) {
        recordStructLocal(init.identifier.tokenLiteral(), init.expression.name);
      }
      walk(stmt.loopBody);
      return;
    }
    if (stmt instanceof SwitchStatement) {
      for (const c of stmt.cases) {
        walk(c.body);
      }
      if (stmt.default) {
        walk(stmt.default);
      }
    }
  }

  walk(s);
  return { totalSize: total, offsets };
}

export function extractLocals(s: ASTStatement, builder: ModuleEmitter) {
  if (s instanceof FunctionStatement) {
    extractLocals(s.fnExpr.body, builder);
    return;
  }
  if (s instanceof LetStatement) {
    if (s.pattern instanceof TuplePattern) {
      if (s.expression instanceof CallExpression) {
        const returnTypes = builder.getCallReturnTypes(s.expression.func) ?? [];
        for (let i = 0; i < s.pattern.names.length; i++) {
          const name = s.pattern.names[i]!;
          if (name.kind !== "name") continue;
          builder.defLocal({
            name: name.value,
            type: returnTypes[i] ?? "i32",
            scope: "local",
          });
        }
      }
      return;
    }
    if (s.expression instanceof StructLiteralExpression) {
      builder.defLocal({
        name: s.identifier.tokenLiteral(),
        type: s.expression.name,
        scope: "local",
      });
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
    if (init.pattern instanceof TuplePattern) {
      if (init.expression instanceof CallExpression) {
        const returnTypes = builder.getCallReturnTypes(init.expression.func) ?? [];
        for (let i = 0; i < init.pattern.names.length; i++) {
          const name = init.pattern.names[i]!;
          if (name.kind !== "name") continue;
          builder.defLocal({
            name: name.value,
            type: returnTypes[i] ?? "i32",
            scope: "local",
          });
        }
      }
      extractLocals(s.loopBody, builder);
      return;
    }
    if (init.expression instanceof StructLiteralExpression) {
      builder.defLocal({
        name: init.identifier.tokenLiteral(),
        type: init.expression.name,
        scope: "local",
      });
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
  if (s instanceof SwitchStatement) {
    for (const c of s.cases) {
      extractLocals(c.body, builder);
    }
    if (s.default) {
      extractLocals(s.default, builder);
    }
  }
}
