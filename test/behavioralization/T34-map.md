# T34 WAT-Assertion Conversion Map

This map inventories every pre-T34 WAT-text assertion in T34's named
`test/compiler.test.ts` describe blocks. Categories follow the T33 convention:
behavioral `(a)`, module/host structure `(b)`, formatting-only `(c)`, and
transitional `(d)`. `checker` marks deliberately invalid fixtures, `legacy`
marks direct-emitter coverage owned by T38, and `retained` marks the explicit
determinism exception in the T34 work order.

Every `(a)` replacement compiles through `checkedCompile`, which asserts zero
type-checker errors before the emitted module is assembled and executed with
`runExport`. There were no `(b)`, `(c)`, or `(d)` sites in these scalar blocks.

## Scalar expressions and statements

| ID | Original test / WAT assertion site(s) | Category | T34 disposition |
|---|---|---|---|
| S01 | `if without else emits if/then`: `(if`, `(then` | (a) | Executes positive and zero inputs and observes `1` / `0`. |
| S02 | `if with else emits else block`: `(else` | (a) | Executes both branches and observes `1` / `2`. |
| S03 | `for loop emits loop and branch instructions`: `(loop`, `br_if`, `br $` | (a) | Counts three body executions, proving condition, body, and update. |
| S04 | `while loop emits loop and branch instructions`: `(loop`, `br_if` | (a) | Mutates and returns the loop variable after three iterations. |
| S05 | `break in loop emits branch`: `br $` | (a) | Observes exactly one body execution before `break`. |
| S06 | `i32 + emits i32.add`: `i32.add` | (a) | Executes `1 + 2 == 3`. |
| S07 | `f32 + emits f32.add`: `f32.add` | (a) | Executes `1.0 + 2.0 == 3`. |
| S08 | `i32 -, *, / emit expected opcodes`: `i32.sub`, `i32.mul`, `i32.div_s` | (a) | Executes the same composed expression with `9, 3` and observes `18`. |
| S09 | `f32 -, *, / emit expected opcodes`: `f32.sub`, `f32.mul`, `f32.div` | (a) | Executes the same composed expression with `9, 3` and observes `18`. |
| S10 | `i32 % emits i32.rem_s`: `i32.rem_s` | (a) | Observes signed remainder `-7 % 3 == -1`. |
| S11 | `i32 > and < emit signed i32 comparison opcodes`: `i32.gt_s`, `i32.lt_s` | (a) | Executes both comparisons on `-1, 1`, proving signed ordering. |
| S12 | `f32 > and < emit f32 comparison opcodes`: `f32.gt`, `f32.lt` | (a) | Executes both comparisons on `2.5, 1.5`. |
| S13 | `i32 >= and <= emit signed ge/le opcodes`: `i32.ge_s`, `i32.le_s` | (a) | Executes both inclusive comparisons at equality. |
| S14 | `f32 >= and <= emit f32 ge/le opcodes`: `f32.ge`, `f32.le` | (a) | Executes both inclusive comparisons at equality. |
| S15 | `== and != emit eq/ne opcodes`: `i32.eq`, `i32.ne`, `f32.eq`, `f32.ne` | (a) | Executes integer and float equality and inequality exports. |
| S16 | `&& and \|\| emit short-circuiting if blocks`: two `assert.match` branch-shape regexes | (a) | Side-effect counter proves false-`&&` and true-`\|\|` skip their right operands. |
| S17 | `& \| ^ emit bitwise opcodes`: `i32.and`, `i32.or`, `i32.xor` | (a) | Executes the same composed bitwise expression and observes `14`. |
| S18 | `<< and >> emit shift opcodes`: `i32.shl`, `i32.shr_s` | (a) | Executes the same shift composition on `-8`, proving signed right shift. |
| S19 | `logical not emits i32.eqz`: `i32.eqz` | (a) | Executes `!0` and `!3`, observing `1` / `0`. |
| S20 | `prefix minus emits arithmetic negation`: zero-minus WAT fragment | (a) | Executes integer negation and observes `-7`. |
| S21 | `prefix minus emits f32.neg for floats`: `f32.neg` | (a) | Executes float negation and observes `-2.5`. |
| S22 | `bitwise not emits xor -1`: `i32.xor`, `i32.const -1` | (a) | Executes `~5 == -6`. |
| S23 | `postfix increment/decrement emit updates`: local set, `1`, `-1` constants | (a) | Executes both mutations and observes that the value returns to `3`. |
| S24 | `i32 as f32 emits f32.convert_i32_s`: signed conversion opcode | (a) | Converts `-7` and observes `-7.0`. |
| S25 | `f32 as i32 emits i32.trunc_f32_s`: signed truncation opcode | (a) | Converts `3.9` and observes truncation to `3`. |
| S26 | `i32 as u8 emits no conversion opcode`: no `convert`, no `trunc`, and `local.get $n` | (a) | Converts `300` and observes low-byte truncation to `44`. |
| S27 | `cast inside binary expression resolves correct type`: `f32.add`, `f32.convert_i32_s` | (a) | Executes the cast inside the addition and observes `4.0`. |
| S28 | `i64 addition uses i64.add and result i64`: result lane and `i64.add` | (a) | Executes above the i32 range and observes `4_000_000_005n`; metadata signature assertion remains. |
| S29 | `u32 division uses unsigned i32.div_u`: `i32.div_u` | (a) | Divides the unsigned lane for `-1 / 2` and observes `2_147_483_647`. |
| S30 | `i32 division uses signed i32.div_s`: `i32.div_s` | (a) | Divides `-9 / 2` and observes `-4`. |
| S31 | `u64 division uses i64.div_u`: `i64.div_u` | (a) | Divides unsigned `-1n / 2n` and observes `9_223_372_036_854_775_807n`. |
| S32 | `u64 right shift uses i64.shr_u`: `i64.shr_u` | (a) | Shifts unsigned `-1n` right and observes zero fill. |
| S33 | `i64 right shift uses i64.shr_s`: `i64.shr_s` | (a) | Shifts `-8n` right and observes sign-preserving `-4n`. |
| S34 | `f64 remainder lowers via f64.trunc / div / mul / sub`: all four opcodes | (a) | Executes `-7.5 % 2 == -1.5`. |
| S35 | `struct member typed i64 loads with i64.load`: `i64.load` | (a) | Initializes and reads the i64 field, observing `2n`. |
| S36 | `resolved import with I_I emits i64 param and result in type`: type name, i64 param, i64 result | legacy | Direct `emitModule` unit moved unchanged to `legacy emitter unit (dies with T38)`. |
| S37 | `idx++ as statement emits plain local.set, not block-with-result`: mutation present, result block absent | (a) | Executes the statement and observes `idx == 1`. |
| S38 | `idx-- as statement emits plain local.set, not block-with-result`: mutation present, result block absent | (a) | Executes the statement and observes `idx == 4`. |
| S39 | `idx++ as statement increments by 1 in emitted WAT`: exact add fragment | (a) | Consolidated into S37's execution result. |
| S40 | `idx-- as statement decrements by 1 in emitted WAT`: exact add-negative-one fragment | (a) | Consolidated into S38's execution result. |
| S41 | `postfix as rvalue still emits block-with-result`: result block present | (a) | Observes old and mutated values together as `34`. |
| S42 | `compound assigns are desugared through binary ops`: ten arithmetic/bitwise/shift opcode checks | (a) | Executes all ten compound assignments in sequence and observes `8`. |
| S43 | `integer literal emits i32.const`: `i32.const 42` | (a) | Returns and observes `42`. |
| S44 | `negative integer literals fold to a constant`: negative const present and zero-minus absent | (a) | Returns and observes `-5`; constant-fold printer shape is no longer pinned. |
| S45 | `folded negative zero retains its sign`: `f32.const -0` | (a) | Uses `Object.is` on the execution result to prove IEEE-754 negative zero. |
| S46 | `float literal emits f32.const`: `f32.const 3.14` | (a) | Returns the f32 value within float precision. |
| S47 | `boolean literals emit i32 consts`: `i32.const 1`, `i32.const 0` | (a) | Executes both literal exports and observes canonical `1` / `0`. |
| S48 | `string literal in let emits pointer constant and data segment`: string local, pointer set, data segment | (a) | Reads the materialized string's length and observes `5`. |

The non-WAT metadata assertion in the i64-addition test remains. The literal
block's string-payload metadata test and invalid-character parser test were
not WAT-text sites and remain unchanged.

## Branching and loops

| ID | Original test / WAT assertion site(s) | Category | T34 disposition |
|---|---|---|---|
| C01 | `else if chain emits nested if/else WAT`: `if`, `else`, and constants `5`, `4`, `3` | (a) | Executes high, middle, and fallback branches. |
| C02 | `three-level else if chain compiles`: constants `10`, `20`, `30`, `40` | (a) | Executes all four outcomes. |
| C03 | `continue in for loop emits br to loop label`: loop and generated branch label | (a) | Counts only odd iterations and observes `4`, proving update after `continue`. |
| C04 | `continue in while loop emits br to loop label`: loop and generated branch label | (a) | Mutates before `continue` and observes termination at `5`. |
| C05 | `const global emits without mut`: immutable global present, mutable form absent | (a) | Reads the const global and observes `100`. |
| C06 | `let global still emits with mut`: mutable global fragment | (a) | Mutates the global and observes `2`. |
| C07 | `switch emits br_if dispatch with each case body`: two dispatch regexes and constants `10`, `20`, `99` | (a) | Executes both cases and the default. |
| C08 | `switch without default still emits the dispatch chain`: case and default-label regexes | (a) | Executes both cases plus an unmatched value that continues after the switch. |
| C09 | `same source compiles to identical WAT on repeated calls`: exact WAT equality | retained | Kept unchanged; T34 explicitly preserves emitter-agnostic determinism. |
| C10 | `two different compilations each start labels at index 0`: exact WAT equality | retained | Kept unchanged; it proves per-compilation state reset without naming a label shape. |
| C11 | `inferred i32 local emits correct local declaration and set`: inferred local and set fragments | (a) | Returns the inferred local and observes `5`. |
| C12 | `inferred f32 local emits correct local declaration and set`: inferred local and set fragments | (a) | Returns the inferred local and observes `3.14` within f32 precision. |
| C13 | `for loop with non-zero init emits local.set before the loop block`: `indexOf` presence and ordering predicates | (a) | Sums `5..<10` and observes `35`, proving initialization precedes iteration. |
| C14 | `for loop with negative init emits local.set before the loop block`: `indexOf` presence and ordering predicates | (a) | Sums `-3..<2` and observes `-5`. |
| C15 | `for loop with zero init still emits local.set before the loop block`: block presence, set presence, and `indexOf` ordering | (a) | Sums `0..<3` and observes `3`. |
| C16 | `if/else both returning f32 emits (result f32) not (result i32)`: i32 result absent | (a) | Executes both f32 return paths; a post-if global write stays unreachable. |
| C17 | `nested if returns that are all f32 still emit outer (result f32)`: f32 result present, i32 result absent | (a) | Executes all three nested paths; a post-if global write stays unreachable. |
| C18 | `if with only void returns does not emit a synthetic result type`: i32 and f32 results absent | (a) | Both void branches set distinct global values and return before a sentinel write. |
| C19 | `if/else both returning i32 emits (result i32)`: i32 result present | (a) | Executes both i32 return paths and proves a post-if global write is unreachable. |
| C20 | `if with void function as condition throws MapleError` | checker | Invalid fixture now asserts the checker diagnostic `void call used as a value`. |
| C21 | `if with f32 condition emits f32.ne`: `f32.ne` | (a) | Executes nonzero and zero f32 conditions and observes truthiness. |
| C22 | `if with i32 condition emits i32.ne`: `i32.ne` | (a) | Executes nonzero and zero i32 conditions and observes truthiness. |
| C23 | `for loop with void function as condition throws MapleError` | checker | Invalid fixture now asserts the checker diagnostic `void call used as a value`. |
| C24 | `while loop with void function as condition throws MapleError` | checker | Invalid fixture now asserts the checker diagnostic `void call used as a value`. |
| C25 | `for loop with f32 condition emits f32.ne`: `f32.ne` | (a) | Executes one iteration, clears the condition, and observes `1`. |
| C26 | `while loop with bool condition passes through directly`: `local.get $b` | (a) | Executes one iteration, clears the bool, and observes `1`. |
| C27 | `while loop with i32 condition wraps in i32.ne`: `i32.ne` | (a) | Counts down an i32 condition and observes three iterations. |
| C28 | `break outside any loop or switch throws error` | checker | Invalid fixture now asserts the checker context diagnostic directly. |
| C29 | `continue outside any loop throws error` | checker | Invalid fixture now asserts the checker context diagnostic directly. |
| C30 | `break in for loop emits valid br instruction`: generated break label | (a) | Observes one for-loop body execution. |
| C31 | `continue in for loop emits valid br instruction to loop label`: generated loop label | (a) | Observes zero statements after `continue` while termination proves updates still run. |
| C32 | `break in while loop emits valid br instruction`: generated break label | (a) | Observes one while-loop body execution. |
| C33 | `continue in while loop emits valid br instruction`: generated loop label | (a) | Observes the counter reach `5`. |
| C34 | `break in standalone switch does not emit (br undefined)`: invalid branch text absent | (a) | Both switch paths assign, break, and reach code after the switch. |
| C35 | `break inside switch inside for loop targets the switch exit`: invalid branch absent and switch label present | (a) | Both switch paths let all three outer-loop iterations complete. |
| C36 | `continue inside switch inside for loop targets the for loop`: loop label present and invalid branch absent | (a) | Skips exactly one outer-loop increment and observes `4`. |
| C37 | `switch case body has implicit exit after case body`: generated-break regex | (a) | Assigning case bodies execute without fallthrough for case 0, case 1, and default. |
| C38 | `nested for loops - break in inner loop targets inner loop's break label`: invalid branch absent plus `wat.match`/`Set` distinct-label count | (a) | Inner `break` runs once per outer iteration, producing `3`. |
| C39 | `if inside for loop with break targets the for loop`: invalid branch absent and break label present | (a) | Counts through `i == 3`, then breaks and observes `4`. |
| C40 | `return inside for loop inside if emits return correctly`: return fragment | (a) | Positive input returns `10` from the loop; zero input reaches the fallback `0`. |
| C41 | `switch without default in if then-branch does not cause spurious result`: `wat.match` result-count predicate | (a) | Case return, unmatched switch, and else return observe `1`, post-if side effect `3`, and `2`. |
| C42 | `for loop in if then-branch does not cause spurious result`: `wat.match` result-count predicate | (a) | Positive/nonzero, positive/zero-iteration, and else paths observe `1`, post-if side effect `4`, and `-1`. |
| C43 | `while loop in if then-branch does not cause spurious result`: `wat.match` result-count predicate | (a) | Positive/nonzero, positive/zero-iteration, and else paths observe `1`, post-if side effect `4`, and `-1`. |
| C44 | `if/else where both branches have explicit returns emits result`: result fragment present | (a) | Both branches return before a sentinel global write; execution observes `1` / `-1`. |

## Audit result

- 92 pre-T34 test sites were inventoried: 84 behavioral, five invalid checker
  fixtures, two retained determinism checks, and one direct-emitter unit.
- Those sites contained 160 WAT-dependent assertion predicates. All 155
  category-`(a)` predicates were replaced by execution proofs.
- The three direct-emitter WAT predicates are isolated in
  `legacy emitter unit (dies with T38)`; the two exact determinism comparisons
  remain unchanged by explicit contract.
- No category-`(a)` WAT-text assertion remains in a T34-owned block. There are
  no T34-owned host-surface, formatting-only, or transitional survivors.
- T35/T36-owned describe blocks and the local `compile()` helper were not
  changed.
