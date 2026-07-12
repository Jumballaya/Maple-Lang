import { CallExpression } from "../../../parser/ast/expressions/CallExpression";
import { StructLiteralExpression } from "../../../parser/ast/expressions/StructLiteralExpression";
import type { LetStatement } from "../../../parser/ast/statements/LetStatement";
import { TuplePattern } from "../../../parser/ast/statements/TuplePattern";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { wasmStoreOp } from "../emit.types";
import { emitExpression } from "../expression/expression";

// The name binds into scope only AFTER the initializer is emitted, so
// `let x = x + 1;` reads the outer `x`.
export function emitLetStatement(stmt: LetStatement, emitter: ModuleEmitter) {
  if (stmt.pattern instanceof TuplePattern) {
    emitDestructureLetStatement(stmt, emitter);
    return;
  }
  const srcName = stmt.identifier.tokenLiteral();
  const localName = stmt.resolvedName ?? srcName;

  if (stmt.expression instanceof StructLiteralExpression) {
    const structName = stmt.expression.name;
    const sd = emitter.getStruct(structName);
    if (!sd) {
      throw new Error(`[let] unknown struct: "${structName}"`);
    }
    const base = `(local.get $${localName})`;
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
    emitter.bindLocal(srcName, localName);
    return;
  }

  const rhs = emitExpression(stmt.expression!, emitter);
  emitter.writer.line(`(local.set $${localName} ${rhs})`);
  emitter.bindLocal(srcName, localName);
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
    const localName = stmt.resolvedNames?.[i] ?? (name.kind === "name" ? name.value : null);
    if (localName === null) {
      emitter.writer.line("(drop)");
      continue;
    }
    emitter.writer.line(`(local.set $${localName})`);
  }
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    const localName = stmt.resolvedNames?.[i];
    if (name.kind === "name" && localName) {
      emitter.bindLocal(name.value, localName);
    }
  }
}
