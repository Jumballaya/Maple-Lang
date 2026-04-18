import { CallExpression } from "../../../parser/ast/expressions/CallExpression";
import { StructLiteralExpression } from "../../../parser/ast/expressions/StructLiteralExpression";
import type { LetStatement } from "../../../parser/ast/statements/LetStatement";
import { TuplePattern } from "../../../parser/ast/statements/TuplePattern";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { wasmStoreOp } from "../emit.types";
import { emitGet, emitSet } from "../expression/core";
import { emitExpression } from "../expression/expression";

export function emitLetStatement(stmt: LetStatement, emitter: ModuleEmitter) {
  if (stmt.pattern instanceof TuplePattern) {
    emitDestructureLetStatement(stmt, emitter);
    return;
  }
  if (stmt.expression instanceof StructLiteralExpression) {
    const structName = stmt.expression.name;
    const sd = emitter.getStruct(structName);
    if (!sd) {
      throw new Error(`[let] unknown struct: "${structName}"`);
    }
    const baseName = stmt.identifier.tokenLiteral();
    const base = emitGet(baseName, emitter);
    const fields = Object.values(sd.members).sort((a, b) => a.offset - b.offset);
    for (const m of fields) {
      const fieldExpr = stmt.expression.members[m.name];
      if (!fieldExpr) {
        throw new Error(`[let] struct "${structName}" initializer missing field "${m.name}"`);
      }
      const storeOp = wasmStoreOp(m.type);
      const val = emitExpression(fieldExpr, emitter);
      emitter.writer.line(`(${storeOp} (i32.add ${base} (i32.const ${m.offset})) ${val})`);
    }
    return;
  }
  emitter.writer.line(emitSet(stmt.identifier.tokenLiteral(), stmt.expression!, emitter));
}

function emitDestructureLetStatement(stmt: LetStatement, emitter: ModuleEmitter): void {
  if (!(stmt.expression instanceof CallExpression)) {
    throw new Error("[destructure let] expected call expression rhs");
  }
  if (!(stmt.pattern instanceof TuplePattern)) {
    throw new Error("[destructure let] expected tuple pattern");
  }

  emitter.writer.line(emitExpression(stmt.expression, emitter));
  const names = stmt.pattern.names;
  for (let i = names.length - 1; i >= 0; i--) {
    const name = names[i]!;
    if (name.kind === "discard") {
      emitter.writer.line("(drop)");
      continue;
    }
    emitter.writer.line(`(local.set $${name.value})`);
  }
}
