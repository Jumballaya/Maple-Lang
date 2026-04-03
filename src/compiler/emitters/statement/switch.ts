import type { SwitchStatement } from "../../../parser/ast/statements/SwitchStatement";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { makeLabel } from "../emitter.utils";
import { emitExpression } from "../expression/expression";
import { emitStatement } from "./statement";

export function emitSwitchStatement(stmt: SwitchStatement, emitter: ModuleEmitter): void {
  //
  // WAT br_table pattern:
  //
  // (block $switch_break   ;; <-- break label pushed onto emitter break stack
  //   (block $switch_default
  //     (block $switch_case_1
  //       (block $switch_case_0
  //         (br_table $switch_case_0 $switch_case_1 $switch_default (local.get $x))
  //       )
  //       ;; case 0 body
  //       (br $switch_break)   ;; implicit exit after each case
  //     )
  //     ;; case 1 body
  //     (br $switch_break)
  //   )
  //   ;; default body
  // )
  //

  const sorted = [...stmt.cases].sort((a, b) => a.test - b.test);
  const defaultLabel = makeLabel("switch_default");
  const caseLabels = sorted.map(() => makeLabel("switch_case"));

  // Push a break label so that `break;` inside a case targets the switch exit
  const switchBreakLabel = emitter.makeLabel("break");

  // Build the jump table: index 0..maxVal -> label, out-of-range -> defaultLabel
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

  // Outermost block is the switch exit (and the break target).
  // The inner default block is used as the br_table fallback so unmatched values
  // land right before the default body (still inside break-label scope).
  emitter.writer.open(`(block ${switchBreakLabel}`);
  emitter.writer.open(`(block ${defaultLabel}`);

  // Open one block per case in reverse order so innermost = lowest case
  for (let i = caseLabels.length - 1; i >= 0; i = i - 1) {
    emitter.writer.open(`(block ${caseLabels[i]}`);
  }

  // Dispatch
  const cond = emitExpression(stmt.switchExpr, emitter);
  emitter.writer.line(`(br_table ${table.join(" ")} ${cond})`);

  // Close each case block and emit its body, then implicit exit to switch end
  for (let i = 0; i < sorted.length; i = i + 1) {
    emitter.writer.close(")");
    const c = sorted[i];
    if (c !== undefined) {
      emitStatement(c.body, emitter);
    }
    emitter.writer.line(`(br ${switchBreakLabel})`);
  }

  // Close each case and the default-dispatch block, then emit default body.
  emitter.writer.close(")");
  if (stmt.default) {
    emitStatement(stmt.default, emitter);
  }
  emitter.writer.close(")");

  emitter.destroyLabel("break", switchBreakLabel);
}
