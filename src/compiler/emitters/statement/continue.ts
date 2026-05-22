import type { ContinueStatement } from "../../../parser/ast/statements/ContinueStatement";
import { MapleError } from "../../errors";
import type { ModuleEmitter } from "../../ModuleEmitter";

export function emitContinueStatement(stmt: ContinueStatement, emitter: ModuleEmitter): void {
  const target = emitter.getCurrentLabel("continue");
  if (target === undefined) {
    throw new MapleError(
      "continue statement must be inside a loop",
      stmt.token.line,
      stmt.token.col,
    );
  }
  emitter.writer.line(`(br ${target})`);
}
