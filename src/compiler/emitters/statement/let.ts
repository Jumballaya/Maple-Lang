import { StructLiteralExpression } from "../../../parser/ast/expressions/StructLiteralExpression";
import type { LetStatement } from "../../../parser/ast/statements/LetStatement";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { wasmStoreOp } from "../emit.types";
import { emitGet, emitSet } from "../expression/core";
import { emitExpression } from "../expression/expression";

export function emitLetStatement(stmt: LetStatement, emitter: ModuleEmitter) {
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
