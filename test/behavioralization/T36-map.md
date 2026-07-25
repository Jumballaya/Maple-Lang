# T36 WAT-Assertion Conversion and Closeout Map

This map inventories every pre-T36 test in the T36-owned
`test/compiler.test.ts` blocks, then closes the three-file behavioralization
audit begun by [T33](./T33-map.md), [T34](./T34-map.md), and
[T35](./T35-map.md). Categories follow the T33 convention: behavioral `(a)`,
host/module structure `(b)`, formatting-only `(c)`, transitional `(d)`, and
`legacy` for direct-emitter units owned by T38. `non-WAT` marks owned tests
whose assertions inspect metadata, resolution, diagnostics, or APIs rather
than emitted text.

Every `(a)` replacement either compiles through `checkedCompile`, which asserts
zero parser and type-checker errors, or through the production merged compiler,
which performs the same checks before assembly and execution.

## Functions and variables

| ID | Original test / assertion site(s) | Category | T36 disposition |
|---|---|---|---|
| C01 | `void function emits func without result`: function present, result absent | (a) | Calls the void function and observes its global side effect `7`. |
| C02 | `i32 return emits i32 result and constant`: result lane and constant | (a) | Executes the exported function and observes `1`. |
| C03 | `f32 return emits f32 result and constant`: result lane and constant | (a) | Executes the exported function and observes `1.5`. |
| C04 | `exported function emits export`: export clause | (b) | Consolidated into `exports functions and owns memory by default` with a whitespace-tolerant inline-export regex. |
| C05 | `function params emit expected wasm params`: two params and their reads | (a) | Calls `add(3, 4)` and observes `7`. |
| C06 | `mixed param types emit expected wasm params`: i32/f32 params | (a) | Calls the mixed-lane function and observes both arguments contributing to `7`. |
| C07 | `function call emits call instruction`: call fragment | (a) | Executes the caller and observes the callee's `1`. |
| C08 | `function call with arguments emits args before call`: both constants and call | (a) | Executes `add(3, 4)` through the caller and observes `7`. |
| C09 | `param count is not duplicated`: WAT param count | (a) | Calls all four parameters, including f32, and observes their sum `10`. |
| C10 | `local i32 let emits local and local.set` | (a) | Returns the local and observes `5`. |
| C11 | `local f32 let emits local and local.set` | (a) | Returns the local and observes `3.25`. |
| C12 | `local bool let emits i32 local and i32 const` | (a) | Returns the boolean local and observes canonical truth `1`. |
| C13 | `global f32 let emits mutable f32 global` | (a) | Reads the global through an export and observes `1.5`. |
| C14 | `global i32 let emits mutable global` | (a) | Reads the global through an export and observes `5`. |
| C15 | `i32 assignment emits local.set with i32 value` | (a) | Assigns and reads back `10`. |
| C16 | `f32 assignment emits local.set with f32 value` | (a) | Assigns and reads back `2.5`. |

## Metadata, pipeline, and source resolution

| ID | Original test / assertion site(s) | Category | T36 disposition |
|---|---|---|---|
| C17 | `single import populates metadata` | non-WAT | Kept untouched; it inspects the metadata object. |
| C18 | `multi import populates metadata entries` | non-WAT | Kept untouched; it inspects the metadata object. |
| C19 | `import emission includes import and type when import is resolved as function` | legacy | Direct `emitModule` WAT unit moved unchanged to `legacy emitter unit (dies with T38)`. |
| C20 | `exported function appears in exports metadata` | non-WAT | Kept untouched. |
| C21 | `exported global appears in exports metadata` | non-WAT | Kept untouched. |
| C22 | `exported struct appears in exports` | non-WAT | Kept untouched. |
| C23 | `non-exported struct does not appear in exports` | non-WAT | Kept untouched. |
| C24 | `mixed exported and non-exported structs keep struct metadata but only export public` | non-WAT | Kept untouched. |
| C25 | `compiler function accepts output path parameter` | non-WAT | Kept untouched; it inspects the API. |
| C26 | `compiler reports file errors for missing input` | non-WAT | Kept untouched; it asserts a filesystem diagnostic. |
| C27 | `compiler reports top-level destructuring let parse error` | non-WAT | Kept untouched; it asserts the production diagnostic. |
| C28 | `emitted wat is wrapped in module`: `startsWith` / `endsWith` | (c) | Deleted. Successful `wat2wasm` assembly already validates the module envelope without pinning printer delimiters. |
| C29 | `emitted wat owns and exports memory by default`: owned memory present, runtime import absent | (b) | Consolidated with C04 using tolerant memory/import regexes. |
| C30 | `emitModule can request an imported memory`: imported memory present, owned memory absent | legacy | Direct `emitModule` WAT unit moved unchanged to the T38 legacy block. |
| C31 | `bare string resolves to bundled Maple source before a local file` | non-WAT | Kept untouched; it inspects resolution metadata and path. |
| C32 | `bare math resolves through bundled Maple source` | non-WAT | Kept untouched. |
| C33 | `bare memory resolves through bundled Maple source` | non-WAT | Kept untouched. |
| C34 | `unknown bare imports keep the existing file error` | non-WAT | Kept untouched. |
| C35 | `relative string paths resolve to the importer-local file` | non-WAT | Kept untouched. |

## Inference, multi-return, and destructuring

| ID | Original test / assertion site(s) | Category | T36 disposition |
|---|---|---|---|
| C36 | `inferred i32 from function call emits correct local.set`: local type/set/call | (a) | Returns the inferred local and observes `3`. |
| C37 | `inferred f32 from function call emits correct local.set`: f32 local | (a) | Returns the inferred local and observes `1.5`. |
| C38 | `multi-return function emits multi result clause` | (a) | Calls the exported swap and observes `[2, 1]`. |
| C39 | `multi-return signature encodes all result lanes` | non-WAT | Kept untouched; it inspects `meta.functions.pair.signature`. |
| C40 | `three-return signature encodes all result lanes`: metadata plus result clause | (a) + non-WAT | Keeps the metadata assertion and executes all three results as `[1, 2, 3]`. |
| C41 | `five-return signature encodes all result lanes`: metadata plus result clause | (a) + non-WAT | Keeps the metadata assertion and executes `[1, 2, 3, 4, 5]`. |
| C42 | `six-return signature encodes all result lanes`: metadata plus result clause | (a) + non-WAT | Keeps the metadata assertion and executes all six results. |
| C43 | `multi-value return emits both values`: return and constants | (a) | Executes the export and observes `[1, 2]` in source order. |
| C44 | `pass-through return emits direct call return`: sliced function body | (a) | Executes the pass-through and observes `[2, 1]`. |
| C45 | `destructuring let emits reverse local.set order`: call/set ordering | (a) | Encodes both bindings as `21`, proving positional binding independent of stack order. |
| C46 | `destructuring let with discard emits drop`: call/set/drop ordering | (a) | Uses `(_, y)` and observes only `y == 1`. |
| C47 | `destructure locals are declared with per-result types`: i32/i64 locals | (a) | Uses both typed bindings in an i64 result and observes `3n`. |
| C48 | `statement-level multi-return call emits drops`: call plus two drops | (a) | Executes a statement-position call and then returns `7`; incorrect discard leaves an invalid stack. |
| C49 | `statement-level five-return call emits five drops`: sliced drop count | (a) | Executes the five-result call in statement position and returns `9`. |
| C50 | `destructuring five-return emits reverse order sets with discard drop` | (a) | Combines four bindings and one wildcard, observing positional encoding `1345`. |
| C51 | `single-return still emits __ret_tmp for frame functions` | (a) | Executes the struct-frame function and observes `1`. |
| C52 | `multi-return frame function emits __mret locals` | (a) | Executes the struct-frame function and observes `[1, 2]`, proving result preservation and frame restoration. |

## Stdlib imports and named function references

| ID | Original test / assertion site(s) | Category | T36 disposition |
|---|---|---|---|
| C53 | `imported f32 global emits import and global.get` | (a) + (b) | Production-merged execution observes `PI`; a tolerant global-import regex remains in the structural block. |
| C54 | `WAT section order: imports before table before globals before signatures before functions` | (c) | Deleted. Cross-section printer order is explicitly non-contractual; successful assembly validates legal binary sections. |
| C55 | `fn table is emitted with correct size` | (b) | Kept as a tolerant one-slot table regex in the structural block. |
| C56 | `active elem initializes private trampolines without runtime table writes` | (b) | Keeps tolerant active-element and trampoline-non-export assertions; table guard/write absence remains structural. |
| C57 | `active elem follows deterministic fn-table slot order` | (b) | Keeps a tolerant two-slot element regex for `sub`, then `add`; execution also proves both targets. |
| C58 | `trampoline function forwards to original`: trampoline params and call | (a) | Calls the reference with `1, 2` and observes the original function's `3`. |
| C59 | `fn-type signature declared with env param` | (b) | Keeps a whitespace-tolerant type regex for the environment and argument lanes. |
| C60 | `__make_fnref helper is emitted when closure runtime needed` | (a) | Function-reference creation and invocation execute through the production merged pipeline. |
| C61 | `alloc import synthesized when closure runtime is needed` | (b) | Keeps a tolerant `memory` / `malloc` import regex. |
| C62 | `emitGet for function name produces call to __make_fnref` | (a) | Taking and invoking the named reference produces `3`. |
| C63 | `indirect call emits call_indirect with env+args+idx order` | (a) | The indirect call receives both arguments and returns `3`; wrong operand order cannot validate or produce that result. |
| C64 | `two different functions get distinct slots` | non-WAT | Kept untouched; it inspects `meta.fnTable`. |
| C65 | `same function referenced twice gets one slot (dedup)` | non-WAT | Kept untouched; it inspects `meta.fnTable.size`. |
| C66 | `same fn-type signature used by two functions is declared once` | (b) | Counts only full, tolerant type declarations in the structural block. |
| C67 | `no closure runtime when no fn-refs used` | (b) | Keeps tolerant absence checks for table, helper, and allocator import. |
| C68 | `void function reference emits correct sig type` | (a) + (b) | Executes the void reference and observes its side effect `7`; the environment-lane type remains structurally pinned. |

## Math calls

| ID | Original test / assertion site(s) | Category | T36 disposition |
|---|---|---|---|
| C69 | `Tier 1 f32 imports emit call`: `sqrt` import and three call sites | (a) + (b) | Production-merged execution observes `floor(sqrt(abs_f32(-4))) == 2`; tolerant stdlib import regexes remain. |
| C70 | `Tier 1 f64 and abs_i32 imports emit call`: two calls | (a) + (b) | Executes both imports and observes their combined result `6`; their imports are structurally inventoried. |
| C71 | `Tier 2 imports emit call`: `sin`, `atan2`, `pow`, and `fmod` calls | (a) + (b) | Executes all four in one expression and observes `9`; tolerant import regexes remain. |

## Three-file closeout sweep

T33 explicitly listed several e2e printer/data helpers as temporary exemptions.
T36 closes them rather than carrying hidden WAT assertions beyond the phase.

| ID | Pre-T36 exempt site(s) | Category | T36 closeout |
|---|---|---|---|
| X01 | `starts the merged heap above static data`: `wiredHeapBase(wat)` | (a) | The runtime pointer is now checked above the static-data region, aligned, and the fixture itself verifies its literals remain uncorrupted. |
| X02 | `sizes memory and the heap from more than one page of static data`: `wiredHeapBase` and `memoryMinimumFromWat` | (a) | Runtime memory pages and the returned allocation pointer prove sizing and addressability without parsing WAT. |
| X03 | `resets the heap when heap_init is called explicitly`: parsed generated heap base | (a) | Initializes twice from the same explicit runtime base and observes identical allocation results. |
| X04 | `shakes dead literal data before laying out the heap`: encoded live/dead data and heap-base ordering | (b) | Moved into `compiler.e2e.test.ts`'s marked structural block; the original execution test retains both runtime results. |

## Combined audit

- [T33](./T33-map.md) maps 43 integration/e2e conversion sites and first
  documented the four closeout exemptions resolved above.
- [T34](./T34-map.md) maps 92 scalar-emission sites.
- [T35](./T35-map.md) maps 93 struct/memory sites, including the seven
  explicitly transitional T37 guards.
- T36 maps 71 owned sites: 35 behavioral-only, five split behavioral/
  structural, nine structural-only, two formatting deletions, two legacy
  direct-emitter units, and 18 non-WAT tests. It also closes four T33
  exemption groups.
- The four primary maps therefore account for 299 pre-conversion test sites,
  plus the four formerly exempt closeout groups.
- `test/integration.test.ts` now contains WAT assertions only in
  `host surface (WAT-structural)`.
- `test/compiler.e2e.test.ts` now contains WAT assertions and WAT-parsing
  helpers only in `host surface (WAT-structural)`.
- `test/compiler.test.ts` now contains WAT assertions only in
  `host surface (WAT-structural)` (including the marked T37 transitional
  cohort) or `legacy emitter unit (dies with T38)`.
- No category-`(a)` WAT-text assertion remains in any of the three files, and
  `src/` is unchanged.
