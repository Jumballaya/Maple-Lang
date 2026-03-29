import type { SwitchStatement } from "../../../parser/ast/statements/SwitchStatement.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { makeLabel } from "../emitter.utils.js";
import { emitExpression } from "../expression/expression.js";
import { emitStatement } from "./statement.js";

export function emitSwitchStatement(stmt: SwitchStatement, emitter: ModuleEmitter): void {
  //
  // WAT br_table pattern:
  //
  // (block $default
  //   (block $case_1
  //     (block $case_0
  //       (br_table $case_0 $case_1 $default (local.get $x))
  //     )
  //     ;; case 0 body
  //     (br $default)
  //   )
  //   ;; case 1 body
  //   (br $default)
  // )
  // ;; default body
  //

  const sorted = [...stmt.cases].sort((a, b) => a.test - b.test);
  const defaultLabel = makeLabel("switch_default");
  const caseLabels = sorted.map(() => makeLabel("switch_case"));

  // Build the jump table: index 0..maxVal -> label, out-of-range -> default
  const lastCase = sorted[sorted.length - 1];
  const maxVal = lastCase !== undefined ? lastCase.test : -1;
  const table: string[] = [];
  let caseIdx = 0;
  for (let i = 0; i <= maxVal; i = i + 1) {
    const currentCase = sorted[caseIdx];
    if (currentCase !== undefined && currentCase.test === i) {
      const label = caseLabels[caseIdx];
      table.push(label ?? defaultLabel);
      caseIdx = caseIdx + 1;
    } else {
      table.push(defaultLabel);
    }
  }
  table.push(defaultLabel); // out-of-range fallback

  // Outermost block is the exit target used by all cases after their body
  emitter.writer.open(`(block ${defaultLabel}`);

  // Open one block per case in reverse order so innermost = lowest case
  for (let i = caseLabels.length - 1; i >= 0; i = i - 1) {
    emitter.writer.open(`(block ${caseLabels[i]}`);
  }

  // Dispatch
  const cond = emitExpression(stmt.switchExpr, emitter);
  emitter.writer.line(`(br_table ${table.join(" ")} ${cond})`);

  // Close each case block and emit its body
  for (let i = 0; i < sorted.length; i = i + 1) {
    emitter.writer.close(")");
    const c = sorted[i];
    if (c !== undefined) {
      emitStatement(c.body, emitter);
    }
    emitter.writer.line(`(br ${defaultLabel})`);
  }

  // Close the default block and emit default body
  emitter.writer.close(")");
  if (stmt.default) {
    emitStatement(stmt.default, emitter);
  }
}
