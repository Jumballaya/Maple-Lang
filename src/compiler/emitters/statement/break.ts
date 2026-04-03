import type { BreakStatement } from "../../../parser/ast/statements/BreakStatement";
import { MapleError } from "../../errors";
import type { ModuleEmitter } from "../../ModuleEmitter";

export function emitBreakStatement(stmt: BreakStatement, emitter: ModuleEmitter): void {
  const br = emitter.getCurrentLabel("break");
  if (br === undefined) {
    throw new MapleError(
      "break statement must be inside a loop or switch",
      stmt.token.line,
      stmt.token.col,
    );
  }
  emitter.writer.line(`(br ${br})`);
}
