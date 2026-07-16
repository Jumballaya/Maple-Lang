import type { ASTProgram } from "../../parser/ast/ASTProgram";
import { ArrayLiteralExpression } from "../../parser/ast/expressions/ArrayLiteralExpression";
import { AssignmentExpression } from "../../parser/ast/expressions/AssignmentExpression";
import { BooleanLiteralExpression } from "../../parser/ast/expressions/BooleanLiteralExpression";
import { CallExpression } from "../../parser/ast/expressions/CallExpression";
import { CharLiteralExpression } from "../../parser/ast/expressions/CharLiteralExpression";
import { FloatLiteralExpression } from "../../parser/ast/expressions/FloatLiteralExpression";
import { IntegerLiteralExpression } from "../../parser/ast/expressions/IntegerLiteral";
import { PrefixExpression } from "../../parser/ast/expressions/PrefixExpression";
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
import type { ASTExpression, ASTStatement } from "../../parser/ast/types/ast.type";
import { alignofType, alignTo } from "../../shared/types";
import type { ModuleBuilder } from "../ModuleBuilder";
import type { ModuleEmitter } from "../ModuleEmitter";
import { baseScalar, sizeofType } from "./emit.types";
import type { ModuleMeta, StructData } from "./emitter.types";

type StaticDataBuilder = Pick<
  ModuleBuilder,
  "addBytes" | "dataAlloc" | "deferredGlobalInits" | "getStruct"
>;

export function extractGlobalData(
  stmt: ASTStatement,
  builder: ModuleBuilder,
  insideFunction = false,
  deferArrayElementErrors = false,
) {
  if (stmt instanceof BlockStatement) {
    for (const st of stmt.statements) {
      extractGlobalData(st, builder, insideFunction, deferArrayElementErrors);
    }
    return;
  }
  if (stmt instanceof FunctionStatement) {
    extractGlobalData(stmt.fnExpr.body, builder, true, deferArrayElementErrors);
    return;
  }
  if (stmt instanceof ForStatement) {
    extractGlobalData(stmt.loopBody, builder, insideFunction, deferArrayElementErrors);
    return;
  }
  if (stmt instanceof IfStatement) {
    extractGlobalData(stmt.thenBlock, builder, insideFunction, deferArrayElementErrors);
    if (stmt.elseBlock) {
      extractGlobalData(stmt.elseBlock, builder, insideFunction, deferArrayElementErrors);
    }
    return;
  }
  if (stmt instanceof WhileStatement) {
    extractGlobalData(stmt.loopBody, builder, insideFunction, deferArrayElementErrors);
    return;
  }
  if (stmt instanceof SwitchStatement) {
    for (const c of stmt.cases) {
      extractGlobalData(c.body, builder, insideFunction, deferArrayElementErrors);
    }
    if (stmt.default) {
      extractGlobalData(stmt.default, builder, insideFunction, deferArrayElementErrors);
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
        extractArrayLiteral(expr.value, builder, deferArrayElementErrors);
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
          extractArrayLiteral(p, builder, deferArrayElementErrors);
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
      extractArrayLiteral(stmt.expression, builder, deferArrayElementErrors);
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
      extractArrayLiteral(stmt.expression, builder, deferArrayElementErrors);
    }
    if (stmt.expression instanceof StructLiteralExpression && !insideFunction) {
      extractStructLiteral(stmt.expression, builder);
    }
    // Non-const scalar initializers start at zero and get assigned at startup.
    if (
      !insideFunction &&
      !(stmt.pattern instanceof TuplePattern) &&
      stmt.expression &&
      !isConstInitializer(stmt.expression)
    ) {
      builder.deferredGlobalInits.push({
        kind: "global",
        name: stmt.identifier.tokenLiteral(),
        type: stmt.typeAnnotation,
        expr: stmt.expression,
      });
    }
    return;
  }
}

// String/array/struct literals count as const: the global holds their
// static-data address.
export function isConstInitializer(expr: ASTExpression): boolean {
  if (
    expr instanceof IntegerLiteralExpression ||
    expr instanceof FloatLiteralExpression ||
    expr instanceof BooleanLiteralExpression ||
    expr instanceof CharLiteralExpression ||
    expr instanceof StringLiteralExpression ||
    expr instanceof ArrayLiteralExpression ||
    expr instanceof StructLiteralExpression
  ) {
    return true;
  }
  return (
    expr instanceof PrefixExpression &&
    expr.operator === "-" &&
    (expr.right instanceof IntegerLiteralExpression || expr.right instanceof FloatLiteralExpression)
  );
}

// Arrays share the string layout: an element block followed by an 8-byte
// {len, data} header; the array variable holds the header address.
function extractArrayLiteral(
  expr: ArrayLiteralExpression,
  builder: ModuleBuilder,
  deferElementErrors: boolean,
) {
  const hasUnsupportedElement = expr.elements.some(
    (el) =>
      !(el instanceof IntegerLiteralExpression) &&
      !(el instanceof FloatLiteralExpression) &&
      !(el instanceof BooleanLiteralExpression) &&
      !(el instanceof StringLiteralExpression),
  );
  if (hasUnsupportedElement) {
    if (deferElementErrors) return;
    throw new Error("array literal element must be a literal");
  }

  const elemType = expr.memberType === "string" ? "i32" : baseScalar(expr.memberType);
  const values = expr.elements.map((el) => {
    if (el instanceof IntegerLiteralExpression) {
      return elemType === "i64" || elemType === "u64" ? el.bigValue : el.value;
    }
    if (el instanceof FloatLiteralExpression) {
      return el.value;
    }
    if (el instanceof BooleanLiteralExpression) {
      return el.value ? 1 : 0;
    }
    if (el instanceof StringLiteralExpression) {
      extractStringLiteral(el, builder);
      return el.location;
    }
    throw new Error("array literal element must be a literal");
  });
  const dataAddr = builder.addBytes(
    numToLittleEndian(values, elemType),
    undefined,
    alignofType(elemType),
    expr.memberType === "string" ? values.map((_, index) => index * 4) : undefined,
  );
  const header = numToLittleEndian([expr.elements.length, dataAddr], "i32");
  expr.location = builder.addBytes(header, undefined, 4, [4]);
}

function extractStringLiteral(expr: StringLiteralExpression, builder: StaticDataBuilder) {
  const lit = expr.value;
  const utf8 = new TextEncoder().encode(lit);
  const len = utf8.length;

  //
  //    struct string {
  //      len: i32,
  //      data: *u8,
  //    }
  //
  const rawBytes = Array.from(utf8).reduce((acc, b) => {
    return `${acc}\\${b.toString(16).padStart(2, "0")}`;
  }, "");

  const charPtr = builder.addBytes(rawBytes, undefined, 4);
  const header = numToLittleEndian([len, charPtr], "i32"); // [len, ptr]
  const hdrAddr = builder.addBytes(header, undefined, 4, [4]);
  expr.location = hdrAddr; // string pointer points to header
}

function extractStructLiteral(
  expr: StructLiteralExpression,
  builder: StaticDataBuilder,
  linkedStruct?: StructData,
) {
  const sd = linkedStruct ?? builder.getStruct(expr.name);
  if (!sd) {
    const addr = builder.dataAlloc(0);
    expr.location = addr;
    return;
  }

  const addr = builder.dataAlloc(sd.size, 8);
  let encoded = "";
  let coveredBytes = 0;
  const pointerOffsets: number[] = [];
  const members = Object.values(sd.members).sort((a, b) => a.offset - b.offset);
  for (const member of members) {
    for (; coveredBytes < member.offset; coveredBytes++) {
      encoded += "\\00";
    }
    const value = expr.members[member.name];
    const encodedType = member.type === "string" ? "i32" : member.type;
    if (
      value instanceof IntegerLiteralExpression ||
      value instanceof FloatLiteralExpression ||
      value instanceof BooleanLiteralExpression
    ) {
      const num = typeof value.value === "boolean" ? (value.value ? 1 : 0) : value.value;
      encoded += numToLittleEndian([num], encodedType);
    } else if (value instanceof StringLiteralExpression) {
      extractStringLiteral(value, builder);
      encoded += numToLittleEndian([value.location], "i32");
      pointerOffsets.push(member.offset);
    } else {
      encoded += numToLittleEndian([0], encodedType);
      if (value) {
        builder.deferredGlobalInits.push({
          kind: "memory",
          baseAddr: addr,
          offset: member.offset,
          fieldType: member.type,
          expr: value,
        });
      }
    }
    coveredBytes = member.offset + member.size;
  }
  for (; coveredBytes < sd.size; coveredBytes++) {
    encoded += "\\00";
  }

  builder.addBytes(encoded, addr, 8, pointerOffsets);
  expr.location = addr;
}

export function extractLinkedStructGlobals(program: ASTProgram, meta: ModuleMeta): void {
  const builder: StaticDataBuilder = {
    deferredGlobalInits: meta.deferredGlobalInits,
    getStruct: (name) => meta.structs[name] ?? meta.imports[name]?.structMeta,
    dataAlloc: (size, alignment = 4) => {
      const address = alignTo(meta.dataPtr, alignment);
      meta.dataPtr = address + size;
      return address;
    },
    addBytes: (bytes, address, alignment = 8, pointerOffsets) => {
      const size = Math.floor(bytes.length / 3);
      const target = address ?? builder.dataAlloc(size, alignment);
      meta.data.push({
        bytes,
        addr: target,
        alignment,
        ...(pointerOffsets ? { pointerOffsets } : {}),
      });
      return target;
    },
  };

  for (const statement of program.statements) {
    if (!(statement instanceof LetStatement)) continue;
    if (!(statement.expression instanceof StructLiteralExpression)) continue;
    const structImport = meta.imports[statement.expression.name];
    if (!structImport?.structMeta || meta.structs[statement.expression.name]) continue;
    extractStructLiteral(statement.expression, builder, structImport.structMeta);
  }
}

function numToLittleEndian(ns: (number | bigint)[], type: string) {
  const baseType = baseScalar(type);
  const byteSize = sizeofType(baseType);
  const buffer = new ArrayBuffer(byteSize * ns.length);

  if (baseType === "i32" || baseType === "u32") {
    const i32 = new Int32Array(buffer);
    i32.set(ns.map(Number), 0);
  } else if (baseType === "f32") {
    const f32 = new Float32Array(buffer);
    f32.set(ns.map(Number), 0);
  } else if (baseType === "i64" || baseType === "u64") {
    const i64 = new BigInt64Array(buffer);
    i64.set(
      ns.map((n) => (typeof n === "bigint" ? n : BigInt(Math.trunc(n)))),
      0,
    );
  } else if (baseType === "f64") {
    const f64 = new Float64Array(buffer);
    f64.set(ns.map(Number), 0);
  } else if (baseType === "i8" || baseType === "u8" || baseType === "bool") {
    const u8 = new Uint8Array(buffer);
    u8.set(
      ns.map((n) => Math.trunc(Number(n)) & 0xff),
      0,
    );
  } else if (baseType === "i16" || baseType === "u16") {
    const view = new DataView(buffer);
    for (let i = 0; i < ns.length; i++) {
      view.setInt16(i * 2, Math.trunc(Number(ns[i]!)), true);
    }
  } else {
    throw new Error(`unsupported type: "${baseType}"`);
  }

  return Array.from(new Uint8Array(buffer)).reduce((str, b) => {
    return `${str}\\${b.toString(16).padStart(2, "0")}`;
  }, "");
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
        recordStructLocal(
          stmt.resolvedName ?? stmt.identifier.tokenLiteral(),
          stmt.expression.name,
        );
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
      walk(stmt.initBlock);
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

// Every declaration site gets its own WASM local; colliding names are
// suffixed and stamped onto the AST (resolvedName) for body emission.
export function extractLocals(s: ASTStatement, builder: ModuleEmitter) {
  if (s instanceof FunctionStatement) {
    extractLocals(s.fnExpr.body, builder);
    return;
  }
  if (s instanceof LetStatement) {
    if (s.pattern instanceof TuplePattern) {
      if (s.expression instanceof CallExpression) {
        const returnTypes = builder.getCallReturnTypes(s.expression.func) ?? [];
        s.resolvedNames = s.pattern.names.map((name, i) => {
          if (name.kind !== "name") return null;
          const unique = builder.uniqueLocalName(name.value);
          builder.defLocal({
            name: unique,
            type: returnTypes[i] ?? "i32",
            scope: "local",
          });
          return unique;
        });
      }
      return;
    }
    const type =
      s.expression instanceof StructLiteralExpression ? s.expression.name : s.typeAnnotation;
    const unique = builder.uniqueLocalName(s.identifier.tokenLiteral());
    s.resolvedName = unique;
    builder.defLocal({ name: unique, type, scope: "local" });
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
    extractLocals(s.initBlock, builder);
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
