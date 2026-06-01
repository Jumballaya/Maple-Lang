import type { SwitchStatement } from "../../../parser/ast/statements/SwitchStatement";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { valueTypeToWasm } from "../emit.types";
import { makeLabel } from "../emitter.utils";
import { emitExpression } from "../expression/expression";
import { emitStatement } from "./statement";

/**
 * Switch lowering uses an `i32.eq` chain inside a nest of blocks, one block
 * per case. Each `br_if $caseLabel` jumps out of its block, landing right
 * before the case body; falling off the chain hits `$default`. The chain is
 * linear in the number of cases — independent of the magnitude or density
 * of case values — so `case -1` and `case 1_000_000` cost the same as
 * `case 0`.
 *
 *   (block $break
 *     (block $default
 *       (block $case_1
 *         (block $case_0
 *           (br_if $case_0 (i32.eq cond k0))
 *           (br_if $case_1 (i32.eq cond k1))
 *           (br $default))
 *         ;; case 0 body
 *         (br $break))
 *       ;; case 1 body
 *       (br $break))
 *     ;; default body
 *   )
 */
export function emitSwitchStatement(stmt: SwitchStatement, emitter: ModuleEmitter): void {
  const cases = stmt.cases;
  const defaultLabel = makeLabel("switch_default");
  const caseLabels = cases.map(() => makeLabel("switch_case"));
  const breakLabel = emitter.makeLabel("break");

  emitter.writer.open(`(block ${breakLabel}`);
  emitter.writer.open(`(block ${defaultLabel}`);

  // Innermost block holds the dispatch chain; outer blocks each guard a
  // case body so `br $caseLabel` lands at the right body via fall-through.
  for (let i = caseLabels.length - 1; i >= 0; i = i - 1) {
    emitter.writer.open(`(block ${caseLabels[i]}`);
  }

  const cond = coerceToI32(emitExpression(stmt.switchExpr, emitter), stmt.switchExpr, emitter);
  for (let i = 0; i < cases.length; i = i + 1) {
    const c = cases[i];
    if (c === undefined) continue;
    emitter.writer.line(`(br_if ${caseLabels[i]} (i32.eq ${cond} (i32.const ${c.test})))`);
  }
  emitter.writer.line(`(br ${defaultLabel})`);

  for (let i = 0; i < cases.length; i = i + 1) {
    emitter.writer.close(")");
    const c = cases[i];
    if (c !== undefined) {
      emitStatement(c.body, emitter);
    }
    emitter.writer.line(`(br ${breakLabel})`);
  }

  emitter.writer.close(")"); // $switch_default
  if (stmt.default) {
    emitStatement(stmt.default, emitter);
  }
  emitter.writer.close(")"); // $switch_break

  emitter.destroyLabel("break", breakLabel);
}

function coerceToI32(
  cond: string,
  expr: SwitchStatement["switchExpr"],
  emitter: ModuleEmitter,
): string {
  const mt = emitter.getExprType(expr);
  if (mt === null) return cond;
  const w = valueTypeToWasm(mt);
  if (w === "i64") return `(i32.wrap_i64 ${cond})`;
  if (w === "f32") return `(i32.trunc_f32_s ${cond})`;
  if (w === "f64") return `(i32.trunc_f64_s ${cond})`;
  return cond;
}
