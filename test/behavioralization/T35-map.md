# T35 WAT-Assertion Conversion Map

This map inventories every pre-T35 test and WAT-text assertion in T35's named
`test/compiler.test.ts` describe blocks. Categories follow the T33 convention:
behavioral `(a)`, host/module structure `(b)`, formatting-only `(c)`, and
transitional `(d)`. `legacy` marks emitter-internal defenses owned by T38, and
`non-WAT` marks an owned test without a WAT-text assertion.

Every `(a)` replacement compiles through `checkedCompile`, which asserts parser
and type-checker success before emission, assembly, and execution through
`runExport`. There were no permanent category-`(b)` sites in these blocks.

## Structs, indexing, strings, and methods

| ID | Original test / assertion site(s) | Category | T35 disposition |
|---|---|---|---|
| M01 | `struct metadata includes members and size`: struct/member metadata and size | non-WAT | Kept unchanged; it does not inspect WAT. |
| M02 | `struct let with mixed i32 and f32 members emits store instructions`: i32/f32 stores present; flat member locals absent | (a) | Reads both fields and observes `10 + trunc(3.14) == 13`. |
| M03 | `struct let with only f32 members emits f32.store instructions`: store count and flat locals absent | (a) | Reads both f32 fields and observes `4.0`. |
| M04 | `struct i32 member used in binary arithmetic emits i32.add and i32.load`: add, load count, flat locals absent | (a) | Executes `p.x + p.y == 7`. |
| M05 | `struct member used in comparison emits comparison opcode and i32.load`: comparison/load present, flat local absent | (a) | Executes the comparison and observes `1`. |
| M06 | `struct f32 member used in binary arithmetic emits f32.add and f32.load`: add, load count, flat locals absent | (a) | Executes `v.x + v.y == 4.0`. |
| M07 | `struct member as direct while-loop condition emits loop with i32.load`: loop/load present, flat local absent | (a) | The member drives one iteration, is cleared, and produces `10`. |
| M08 | `prefix minus on struct member emits negation with i32.load`: subtraction/load present, flat local absent | (a) | Executes `-n.val == -7`. |
| M09 | `memory-backed struct param member used in binary arithmetic resolves type correctly`: add/load/parameter pointer | (a) | Passes a local `Pair` to `sum` and observes `7`. |
| M10 | `member access with identifier parent compiles`: function/result shape and exact global-member load | (a) | Reads global `s.a` and observes `1`. |
| M11 | `member access on a function-call base compiles`: call and load present | (a) | Executes `make().x` and observes `42`. |
| M12 | `member access on an unsupported base shape errors` | legacy | Direct `resolveStructMember` defense moved unchanged to `legacy emitter unit (dies with T38)`. |
| M13 | `member assignment on local struct emits i32.store`: store/value present and flat locals absent | (a) | Assigns `t.a = 14` and reads back `14`. |
| M14 | `literal index emits direct load for zero index`: load present | (a) | Reads `arr[0]` and observes `1`. |
| M15 | `variable index emits computed offset load`: multiply and add present | (a) | Reads `arr[x]` for `x == 1` and observes `2`. |
| M16 | `expression index emits computed offset load`: add and load present | (a) | Reads `arr[x + 1]` and observes `3`. |
| M17 | `arr[literal] = val emits i32.store with const offset`: store and `99` present | (a) | Writes index zero and observes `arr[0] == 99` while `arr[1] == 2`. |
| M18 | `arr[var] = val emits i32.store with computed offset`: store/multiply/`42` present | (a) | Writes index one and observes all neighbors as the encoding `523`. |
| M19 | `expression elements throw instead of silently encoding zero` | legacy | Emitter/extract-data defense moved unchanged to the legacy block. |
| M20 | `explicit string local emits i32 local and string pointer set`: local, pointer set, and data segment | (a) | Reads the explicit local's `.len` and observes `5`. |
| M21 | `inferred string local emits i32 local and string pointer set`: local, pointer set, and data segment | (a) | Reads the inferred local's `.len` and observes `5`. |
| M22 | `string .len member access emits load from string header`: load present | (a) | Reads `.len` and observes `5`. |
| M23 | `dotted method declaration emits mangled wasm function name`: function name, receiver/argument params, result | (a) | Calls the declared method on two local structs and observes `4`. |
| M24 | `method call emits mangled call with receiver as first argument`: call and both local arguments | (a) | Calls the method with receiver `5` and argument `7`, observing `12`. |

## Local frames, fields, loads, and stores

| ID | Original test / assertion site(s) | Category | T35 disposition |
|---|---|---|---|
| M25 | `any module emits $__sp global`: exact shadow-stack global | (a) | A local frame round-trips both fields as `12`; recursive-frame isolation is also execution-tested. |
| M26 | `module with no local structs does not emit $__sp`: private global absence | (c) | Deleted. Private helper elision is not language or host behavior. |
| M27 | `$__sp appears before any function in WAT`: presence plus `indexOf` ordering | (c) | Deleted. Cross-section printer order is formatting-only; assembly validates legal ordering. |
| M28 | `local struct does NOT produce flattened $p_x / $p_y locals`: both names absent | (a) | Mutates `p.x` and observes `73`, proving independent memory-backed fields. |
| M29 | `local struct emits single (local $p i32) pointer`: pointer-local fragment | (a) | Replaced by round-trips for i8/u8/i16/u16/i32/u32/i64/u64/bool/f32/f64 in one mixed local struct. |
| M30 | `i32 field x at offset 0 emits i32.store`: exact first-field store | (a) | Reads `x` and neighboring `y`, observing `23`. |
| M31 | `i32 field y at offset 4 emits i32.store`: exact second-field store | (a) | Reads `y` and neighboring `x`, observing `32`. |
| M32 | `mixed i32/f32 struct emits correct store ops per field`: both store opcodes | (a) | Reads both mixed fields and observes `4`. |
| M33 | `f32-only struct emits f32.store for both fields`: flat locals absent and store count | (a) | Reads both fields as the positional encoding `17.5`. |
| M34 | `single-field struct emits one i32.store`: store and value `42` | (a) | Reads the field and observes `42`. |
| M35 | `expression field values emit full expressions as store values`: add/multiply/store | (a) | Initializes from `a + 1` and `b * 2`, observing `38`. |
| M36 | `p.x emits i32.load at offset 0`: exact load and flat local absent | (a) | Reads `p.x` and observes `3`. |
| M37 | `p.y emits i32.load at offset 4`: exact load | (a) | Reads `p.y` and observes `4`. |
| M38 | `f32 member emits f32.load`: f32 load | (a) | Reads `v.x` and observes `1.5`. |
| M39 | `p.x + p.y emits i32.add with two i32.load sub-expressions`: add/load count/flat locals | (a) | Executes the same expression and observes `7`. |
| M40 | `p.x > 0 emits i32.gt_s with i32.load as left operand`: compare/load/flat local | (a) | Executes the same comparison and observes `1`. |
| M41 | `prefix negation on struct member emits i32.sub with i32.load`: subtraction/load/flat local | (a) | Executes the same negation and observes `-7`. |
| M42 | `struct member as while-loop condition emits i32.load`: loop/load/flat local | (a) | The member drives one iteration and the function returns `1`. |
| M43 | `struct member as for-loop condition emits i32.load`: load present | (a) | The loop decrements `p.x` to `0`, which is returned. |
| M44 | `struct member as if condition emits i32.load`: load present and flat local absent | (a) | The truthy member selects the branch and returns `1`. |
| M45 | `struct member as function argument emits i32.load`: call and load present | (a) | Passes `p.x` through `bar` and observes `7`. |
| M46 | `p.x = 10 emits i32.store at offset 0`: exact store | (a) | Writes `x`, reads both fields, and observes `107`. |
| M47 | `p.y = 20 emits i32.store at offset 4`: exact store | (a) | Writes `y`, reads both fields, and observes `720`. |
| M48 | `write-then-read round-trip emits i32.store then i32.load at same offset`: store/load present | (a) | Writes and reads `p.x`, observing `99`. |
| M49 | `function with one Point local emits SP prologue`: exact decrement | (a) | A one-struct function round-trips `12`. |
| M50 | `function with one Point local emits SP epilogue`: exact increment | (a) | Sequential struct-bearing calls preserve distinct results `12` and `34`. |
| M51 | `prologue appears before stores, epilogue after body`: three `indexOf` ordering predicates | (a) | Initialization followed by a member-dependent write produces `5`. |
| M52 | `two Point locals emit frame size 16`: frame-size constant | (a) | Mutates both locals and observes non-overlapping fields as `5236`. |
| M53 | `Big struct (size=16) emits correct frame size`: exact frame decrement | (a) | Reads all four fields and observes their sum `10`. |
| M54 | `function with no local structs does NOT emit SP adjustments`: sliced body excludes SP reads/writes | (c) | Deleted. Private stack-helper elision is an internal optimization. |
| M55 | `function with no local structs does NOT emit $__ret_tmp`: temp absence | (c) | Deleted. Private temporary elision is not observable behavior. |
| M56 | `first struct at offset 0 uses direct global.get`: exact pointer initialization | (a) | Reads the first local's initialized fields and observes `12`. |
| M57 | `second struct at offset 8 uses i32.add`: exact second pointer initialization | (a) | Mutates the second local while preserving the first, observing `1284`. |
| M58 | `pointer inits appear between prologue and body`: three `indexOf` ordering predicates | (a) | Expression-valued field initialization executes safely and observes `45`. |

The new recursion test stores the recursive result before rereading its outer
frame and observes `333`; an overlapping-frame implementation would corrupt
that result.

## Returns, globals, parameters, and control flow

| ID | Original test / assertion site(s) | Category | T35 disposition |
|---|---|---|---|
| M59 | `value-returning return with local struct uses $__ret_tmp`: set/get temp | (a) | Returns `p.x` and observes `3`. |
| M60 | `void return with local struct emits SP restore then return`: restore/return present and temp absent | (a) | Calls the early-returning function 10,000 times; no frame leaks and `visits == 10000`. |
| M61 | `return 42 from function with local struct still uses $__ret_tmp`: temp set | (a) | Returns the scalar `42` with a live local struct. |
| M62 | `multiple return paths both use $__ret_tmp`: temp-set count | (a) | Calls the early value-return path 10,000 times, then the fallback path, observing `30004`. |
| M63 | `f32-returning function with local struct declares f32 $__ret_tmp`: typed temp | (a) | Returns the f32 field and observes `1.5`. |
| M64 | `void function with local struct has no $__ret_tmp`: temp absence | (a) | Calls the void function and observes its struct-derived side effect `12`. |
| M65 | `void function with local struct and value return does not reference $__ret_tmp`: four emitter-shape assertions | legacy | Checker-invalid emitter robustness test moved unchanged to the legacy block. |
| M66 | `I41-43: no $p_x, $p_y ...`: flat member names absent | (a) | Writes one member and observes its neighbor unchanged (`14`). |
| M67 | `break/continue in loop with local struct do NOT emit SP restore`: generated branches plus sliced restore absence | (a) | Runs the function 10,000 times; no premature/double restoration and total is `10000`. |
| M68 | `global struct still emits data segment`: data segment present | (a) | Reads both initialized global fields and observes `23`. |
| M69 | `global struct emits global $g with address`: global pointer shape | (a) | Reads the reversed positional encoding `32`. |
| M70 | `global struct member read uses global.get`: exact global member load | (a) | Reads `g.x` and observes `2`. |
| M71 | `global struct member write uses global.get`: store and global pointer present | (a) | Writes `g.x`, preserves `g.y`, and observes `53`. |
| M72 | `struct param still uses param p and i32.load + offset`: param/load/get | (a) | Passes a local struct to `sum` and observes `7`. |
| M73 | `param struct member type resolves correctly`: i32 add present, f32 add absent | (a) | Adds signed i32 fields `-3` and `4`, observing `1`. |
| M74 | `method call on local struct emits call with local receiver`: call/get | (a) | Calls `sum` and observes `7`. |
| M75 | `method call WAT does NOT contain flat fields`: flat names absent | (a) | Mutates one receiver field and observes the independent-field sum `12`. |
| M76 | `method with extra arg on two local structs emits both pointers`: call and two gets | (a) | Passes two local structs and observes `4`. |
| M77 | `struct member as switch expression emits i32.load`: load present | (a) | The member selects case 1 and returns `1`. |
| M78 | `struct member in binary chain emits multiple i32.load`: load count | (a) | Executes the same repeated-read expression and observes `8`. |
| M79 | `struct member in cast emits i32.load + f32.convert_i32_s`: load/conversion | (a) | Casts `p.x` and observes `5.0`. |
| M80 | `struct member read into scalar local works`: load and local set | (a) | Initializes, increments, and returns the scalar local as `8`. |
| M81 | `local struct inside if-then block gets frame slot`: SP adjustment and store | (a) | Executes taken and untaken paths, observing `12` / `0`. |
| M82 | `local struct inside while body gets frame slot`: SP adjustment | (a) | Reads the body-local fields and observes `56`. |
| M83 | `struct field write inside loop uses store/load`: both operations present | (a) | Decrements one field and increments its neighbor, observing `5`. |
| M84 | `function with local struct literal compiles without error`: `doesNotThrow` | (a) | Executes two call-time local initializations and observes `3478`. |
| M85 | `local struct literal does NOT appear in data segment`: data-segment count | (c) | Deleted. Static-section allocation strategy is private; M84 proves call-time local behavior. |

## T37 transitional guarded-prologue structure

These tests moved unchanged into `host surface (WAT-structural)` beneath the
required marker `// transitional: T37 flips these to guard-ABSENCE`.

| ID | Original test / assertion site(s) | Category | T35 disposition |
|---|---|---|---|
| M86 | `global expression field emits init guard and i32.store`: flag, guard, store, global source | (d) | Kept unchanged for T37. |
| M87 | `init guard emits in exported function only`: `indexOf`, sliced bodies, guard absence/presence | (d) | Kept unchanged for T37. |
| M88 | `literal-only global structs do not emit init guard global`: flag and guard absent | (d) | Kept unchanged for T37. |
| M89 | `f32 expression field uses f32.store in init block`: store and source global | (d) | Kept unchanged for T37. |
| M90 | `mixed literal and expression fields emit one deferred store`: store count | (d) | Kept unchanged for T37. |
| M91 | `multiple global expression fields emit multiple deferred stores`: store count | (d) | Kept unchanged for T37. |
| M92 | `global struct reversed literal field order still stores by struct layout`: data segment and byte order | (d) | Kept unchanged with its guarded-prologue cohort by explicit T35 contract. |
| M93 | `emitExpression throws clear MapleError for struct literal value-position use` | legacy | Direct `emitExpression` defense moved unchanged to the legacy block. |

## Audit result

- 93 pre-T35 test sites are mapped: 76 behavioral replacements, five
  category-`(c)` deletions, seven transitional tests, four legacy defenses,
  and one unchanged non-WAT metadata test.
- The 89 WAT-dependent test sites contained 179 assertion predicates:
  154 category-`(a)`, seven category-`(c)`, 14 category-`(d)`, and four
  legacy-emitter predicates.
- All category-`(a)` WAT predicates were replaced by checker-clean execution.
  The only owned WAT predicates left are the explicitly marked transitional
  block and the T38 legacy emitter block.
- The local `compile()` helper, T34/T36-owned describe blocks, and `src/`
  remain unchanged.
