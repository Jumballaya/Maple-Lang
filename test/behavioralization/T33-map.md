# T33 WAT-Assertion Conversion Map

This map inventories every WAT-text assertion in `test/integration.test.ts` and
`test/compiler.e2e.test.ts` before T33. Categories are the T33 convention:
behavioral `(a)`, host/module structure `(b)`, and formatting-only `(c)`.
All new integration execution fixtures pass through `checkedCompile`, which
asserts parser and type-checker success before compiling. E2E fixtures pass
through the production compiler, whose validation pass type-checks every
module.

## `test/integration.test.ts`

| ID | Original test / assertion site | Category | T33 disposition |
|---|---|---|---|
| I01 | `output is wrapped in a single (module ...)`: `startsWith` and `endsWith` | (c) | Deleted. Parser/printer delimiter formatting has no language behavior; assembly validation covers syntactic validity. |
| I02 | `parentheses are balanced`: `isBalanced(wat)` | (c) | Deleted. This duplicated `wat2wasm` validation and pinned printer formatting. |
| I03 | `module-owned memory export is always present`: owned memory present and runtime memory import absent | (b) | Rewritten as whitespace-tolerant regexes in `host surface (WAT-structural)`. |
| I04 | `all declared functions appear in WAT`: `$alpha`, `$beta`, `$gamma` presence | (a) | Replaced by `declared functions compose at runtime`, which calls exported `gamma` and observes `3`. |
| I05 | `exported functions emit export declarations`: `"add"` export text | (b) | Rewritten as a format-tolerant export regex in the structural block. |
| I06 | `global variables appear in WAT`: `$counter` global text | (a) | Replaced by `globals and multi-function control flow execute`; mutation of `total` is observed through `run`. |
| I07 | `multi-function program with all features has balanced WAT`: balance plus `$clamp`, `$run`, `$MAX`, `$total` | (a) | Replaced by the same typechecked program executing `run(5) == 95`. Internal-name checks were removed as redundant formatting checks. |
| I08 | `for loop with break and continue has balanced WAT`: balance, loop, block | (a) | Replaced by `for break and continue preserve update semantics`, observing the exact sum `18`. |
| I09 | `for-loop continue branches to a $continue block`: balance, generated block, generated branch | (a) | Replaced by the same execution test plus the existing `for-loop continue runs the update clause` runtime matrix. Generated labels were formatting-only. |
| I10 | `switch statement has balanced WAT`: balance and `br_if` | (a) | Replaced by `switch dispatch selects cases and the default`, exercising two cases and the default. |
| I11 | `all binary operators in one function has balanced WAT` | (a) | Replaced by `binary operator families produce observable results`, covering arithmetic, remainder, bitwise, shifts, comparisons, and logical operators. |
| I12 | `postfix and compound assignments have balanced WAT` | (a) | Replaced by `postfix and compound assignments mutate the value`; the fixture now mutates a local so it is checker-clean. |
| I13 | `struct param and member access have balanced WAT` | (a) | Replaced by `struct parameters and member access compose`, observing a call across two struct arguments. |
| I14 | `nested else-if chain has balanced WAT`: balance, `if`, `else` | (a) | Replaced by `nested else-if chains choose the matching branch`, executing all four outcomes. |
| I15 | `single-return call in statement position has trailing drop`: sliced call body regex | (a) | Replaced by `void function discarding single-return call validates` and the execution cases in `unused call results are dropped at statement position`. |
| I16 | `demo 12_math compiles and passes wat2wasm`: math import text | (b) | Moved to `the math demo retains its external host imports` with a whitespace/name-tolerant import regex; binary validation remains in the original test. |
| I17 | `emitted for-loop wraps body in a $continue block`: generated loop/block labels | (a) | Deleted after mapping to `for + continue: skips body but increments` and its surrounding runtime matrix. The generated label shape itself was not behavioral. |
| I18 | `u32 → f32 emits convert_i32_u`: unsigned opcode present, signed opcode absent | (a) | Rewritten as `u32 → f32 preserves values above the signed range`, observing `3_000_000_000`. |
| I19 | `f32 → u32 emits trunc_f32_u`: unsigned opcode present, signed opcode absent | (a) | Rewritten as `f32 → u32 preserves values above the signed range`, observing the Wasm-lane result `-1_294_967_296`. |
| I20 | `signed i32 → f32 still uses convert_i32_s`: signed opcode present, unsigned absent | (a) | Rewritten as `signed i32 → f32 preserves negative values`, observing `-5`. |
| I21 | `u8 → f32 emits unsigned convert` | (a) | Rewritten as `u8 → f32 preserves its unsigned value`, observing `200`. |
| I22 | `WAT: single-return discard → exactly one (drop)` | (a) | Removed in favor of the existing single-return discard instantiation/execution tests. A wrong drop count makes the module invalid. |
| I23 | `WAT: multi-return discard → N (drop)s`: call slice and drop count | (a) | Removed in favor of `discarded multi-return call instantiates and runs`. |
| I24 | `WAT: void-returning call → NO (drop)`: bounded function window | (a) | Replaced by `void-returning calls do not introduce a stack value`, which calls a void helper and then returns `7`. |
| I25 | `WAT: assigned call result → NO trailing drop on call` | (a) | Removed in favor of `call result that is assigned does NOT get extra drop`, observing the assigned value `42`. |
| I26 | `indirect call via fn-typed variable: WAT has drop after call_indirect`: balanced slice plus trailing-drop regex | (a) | Replaced by `discarded indirect-call results leave the stack valid`, run through the merged pipeline and observed returning `7`. |
| I27 | `unsigned shift ignores a signed count and remains unsigned`: `i32.shr_u` and `i32.lt_u` text | (a) | Text assertions removed; the checker-clean fixture still observes unsigned shift and comparison results through both exports. |
| I28 | `struct {u8, i32} aligns b`: frame-size and field-offset regex captures | (a) | Replaced by `aligned mixed-width structs remain independent`, which mutates adjacent mixed-width structs and observes all fields (`316`). |
| I29 | `switch with sparse high case value does not balloon br_table`: WAT length bound | (b) | Moved unchanged into the structural block. The threshold is tolerant of ordinary reformatting and preserves the intentional code-size guard. |

The structural block also tests its memory/import regexes against hand-reformatted
equivalent snippets. After conversion, no category-(a) WAT-text assertion
remains in this file.

## `test/compiler.e2e.test.ts`

| ID | Original test / assertion site | Category | T33 disposition |
|---|---|---|---|
| E01 | `emits a diamond dependency once`: count of `$d$$base` function definitions | (b) | Consolidated as `emits a shared diamond dependency exactly once` with whitespace- and prefix-tolerant matching. Runtime result `23` remains in the original test. |
| E02 | `exports owned memory and only entry-module API names`: textual absence of `add` export | (b) | Text check removed because the same test inspects the binary export list exactly as `["memory", "run"]`. |
| E03 | `keeps same-named struct equality helpers module-local`: two internal helper names | (c) | Deleted. `run() == 2` already proves collision isolation; private helper spelling is emitter-internal. |
| E04 | `takes a function reference from another merged module`: one table count | (b) | Consolidated into `retains the function-reference table, element, and trampoline`; runtime result `42` remains. |
| E05 | `emits byte-identical WAT for identical projects`: exact WAT equality | (b) | Moved into `emits deterministic WAT before and after filtering`. Determinism is emitter-agnostic and intentionally retained. |
| E06 | `removes unreachable private functions from imported modules`: used present, unused absent | (b) | Consolidated into `filters unreachable user functions and exports`; runtime result `42` remains. |
| E07 | Same test: `$dep$$used` precedes `$main$$run` | (c) | Deleted. Cross-section/function ordering is not host behavior and is explicitly forbidden by the conventions. |
| E08 | `removes unreachable exports from non-entry modules`: unused function absent | (b) | Consolidated into `filters unreachable user functions and exports`; the original test now executes `run() == 1`. |
| E09 | `keeps cross-module functions reached only through fn-refs callable`: target/trampoline/table/elem text | (b) | Consolidated into `retains the function-reference table, element, and trampoline` using whitespace- and generated-prefix-tolerant regexes. Trampoline non-export remains binary-inspected. |
| E10 | `does not slot fn-refs created only by unreachable code`: target and creator absent, table absent | (b) | Consolidated into `does not create a table for unreachable function references`; runtime result `42` remains. |
| E11 | `keeps functions reached only from startup initialization`: seed function present | (b) | Consolidated into `retains functions reached only from startup`; initialized value `42` remains execution-proven. |
| E12 | `emits only the used stdlib function chain`: `sqrt`/`sin` presence and absence | (b) | Consolidated into `filters unused stdlib function chains` with tolerant function regexes. Both runtime results remain. |
| E13 | Same test: used WAT byte length exceeds unused WAT | (c) | Deleted. It was formatting-sensitive and redundant with direct reachability absence/presence checks. |
| E14 | `emits deterministic WAT after filtering`: exact equality and unused function absence | (b) | Consolidated into `emits deterministic WAT before and after filtering`. |

The e2e structural block spot-checks its table and element regexes against
hand-reformatted snippets. No category-(a) WAT-text assertion was present in
this file; its WAT checks intentionally describe merged host surface and
reachability.

## Explicitly exempt printer-shape helpers

Per the T33 work order, these existing constraints were inventoried but not
changed:

- `wiredHeapBase(wat)` and its uses in `starts the merged heap above static
  data`, `sizes memory and the heap from more than one page of static data`,
  `resets the heap when heap_init is called explicitly`, and `shakes dead
  literal data before laying out the heap`.
- `memoryMinimumFromWat(wat)` in the multi-page static-data test.
- `encodedData` plus the live/dead/retained data-segment matches in `shakes
  dead literal data before laying out the heap`.
- The related printer-shape constraints in `test/cli.test.ts`,
  `test/memory-ownership.test.ts`, and `test/helpers.ts` are outside T33's two
  owned files and remain for T37/T38 accounting.

## Audit result

- Integration inventory: 29 WAT-dependent test sites, all mapped above.
- E2E owned inventory: 14 converted/consolidated sites, all mapped above.
- E2E printer-helper/data sites: inventoried under the explicit exemption.
- Surviving owned WAT assertions are confined to one marked structural block
  per file; category-(a) assertions are zero outside those blocks.
