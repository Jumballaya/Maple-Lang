import type { ContinueStatement } from "../../../parser/ast/statements/ContinueStatement";
import { MapleError } from "../../errors";
import type { ModuleEmitter } from "../../ModuleEmitter";

export function emitContinueStatement(stmt: ContinueStatement, emitter: ModuleEmitter): void {
  const lp = emitter.getCurrentLabel("loop");
  if (lp === undefined) {
    throw new MapleError(
      "continue statement must be inside a loop",
      stmt.token.line,
      stmt.token.col,
    );
  }
  emitter.writer.line(`(br ${lp})`);
}
