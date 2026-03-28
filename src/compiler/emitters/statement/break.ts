import type { BreakStatement } from "../../../parser/ast/statements/BreakStatement";
import type { ModuleEmitter } from "../../ModuleEmitter";

export function emitBreakStatement(_stmt: BreakStatement, emitter: ModuleEmitter): void {
  const br = emitter.getCurrentLabel("break");
  emitter.writer.line(`(br ${br})`);
}
