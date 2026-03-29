import type { ContinueStatement } from "../../../parser/ast/statements/ContinueStatement";
import type { ModuleEmitter } from "../../ModuleEmitter";

export function emitContinueStatement(_stmt: ContinueStatement, emitter: ModuleEmitter): void {
  const lp = emitter.getCurrentLabel("loop");
  emitter.writer.line(`(br ${lp})`);
}
