import { BreakStatement } from "../../../parser/ast/statements/BreakStatement";
import { ModuleEmitter } from "../../ModuleEmitter";

export function emitBreakStatement(
  stmt: BreakStatement,
  emitter: ModuleEmitter
): void {
  const br = emitter.getCurrentLabel("break");
  emitter.writer.line(`(br ${br})`);
}
