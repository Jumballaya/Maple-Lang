# Maple Language Specification

## Overview

Maple is a statically-typed, compiled language that targets WebAssembly. The compiler lowers the merged source dependency graph through a typed intermediate representation (IR) and emits the final `.wasm` binary directly. WAT (WebAssembly Text Format) and serialized IR are optional debug outputs; no system WebAssembly toolchain is required.

---

## Compilation and CLI

Compile exactly one entry module with `maple [options] <file>`, or through npm:

```bash
npm start -- src/main.maple
npm start -- src/main.maple -o app.wasm
npm start -- --import-memory src/main.maple
```

`-o <file>` and `--output <file>` select the output path and may appear at most once. `--import-memory` may be repeated and is idempotent. Options may appear before or after the input file. Unknown options, a missing input, multiple input files, or a missing output-path value are errors.

### Compiler pipeline

Architecturally, compilation follows this pipeline:

```
parse modules → type-check and annotate → whole-program merge
  → lower to typed IR → run the IR pass hook (empty in this phase)
  → validate IR → encodeWasm → .wasm
                  ├ printWat → optional WAT debug output
                  └ dumpIr   → optional IR debug output
```

The IR validator runs after the pass hook and before binary emission or either debug output. It is an internal compile-time guarantee that malformed IR does not reach a backend, not a language or host API. The former direct AST-to-WAT string emitter is no longer part of the compiler.

For the same resolved entry path and module graph in the same checkout, repeated compilation produces byte-identical `.wasm` and, when requested, byte-identical WAT. This is not a cross-machine or cross-checkout reproducible-build guarantee: bundled-standard-library module keys are relative to the entry module, so checkout location can change internal symbol names.

### Memory ownership

By default, the compiled module owns and exports its linear memory. It has no host imports and can be instantiated without an import object:

```js
const { instance } = await WebAssembly.instantiate(bytes);
const memory = instance.exports.memory;
```

With `--import-memory`, the module instead imports `runtime.memory`; it does not export that memory:

```js
const memory = new WebAssembly.Memory({ initial: requiredInitialPages });
const { instance } = await WebAssembly.instantiate(bytes, {
  runtime: { memory },
});
```

In both modes the declared initial minimum is `max(2, ceil(finalDataEnd / 65536) + 1)`, which covers all live static data plus at least one heap page. A host-provided memory must meet that minimum. See [the memory map](memory_map.md) for the complete layout.

---

## Comments

Maple supports both single-line and block comments.

```maple
// this is a comment

/* this is a
   block comment */
```

---

## Types

### Primitive numeric types

| Type   | Description              |
|--------|--------------------------|
| `i8`   | 8-bit signed integer     |
| `u8`   | 8-bit unsigned integer   |
| `i16`  | 16-bit signed integer    |
| `u16`  | 16-bit unsigned integer  |
| `i32`  | 32-bit signed integer    |
| `u32`  | 32-bit unsigned integer  |
| `i64`  | 64-bit signed integer    |
| `u64`  | 64-bit unsigned integer  |
| `f32`  | 32-bit float             |
| `f64`  | 64-bit float             |
| `bool` | Boolean (`true`/`false`) — backed by `i32` |

All integer variants smaller than `i32` are represented in the WebAssembly `i32` lane. Explicit integer casts to a sub-word type mask or sign-extend to that type's width; float-to-sub-word casts truncate and mask, as detailed under Casts.

`i64` and `u64` use the WebAssembly `i64` lane; `f64` uses the `f64` lane. Struct layout and loads/stores use the full width for these members.

### Special types

| Type     | Description                                      |
|----------|--------------------------------------------------|
| `void`   | Used as a function return type meaning no return value |
| `string` | First-class string type. Backed by a `{ len: i32, data: *u8 }` header in linear memory. |

### Arrays

A type followed by `[]` denotes an array. An array value points to an 8-byte `{ len: i32, data: *element }` header in linear memory. Array literals and their element data are allocated in the static data section.

```maple
let nums: i32[] = [1, 2, 3];
let floats: f32[] = [1.0, 2.0, 3.0];
let count: i32 = nums.len;
```

Array reads are bounds-checked. An index greater than or equal to `.len` traps; the unsigned comparison used by the check also makes negative indices trap.

Array elements may be expressions. Each element must be compatible with the declared element type; integer and float literals adopt that type and are range-checked against it, so `let values: i64[] = [1, 2];` is valid. Elements evaluate once each, from left to right.

Local array and string literals currently use shared static storage rather than fresh storage per call, so writes persist across calls. Dynamic-element array declarations re-initialize every element in that shared buffer each time the declaration executes. Module-scope dynamic arrays perform those stores during WebAssembly instantiation. Fresh-per-call storage remains deferred until the ownership phase.

### Struct types

User-defined named record types. See [Structs](#structs).

---

## Variables

Declared with `let` (mutable) or `const` (immutable). An explicit type annotation is optional when the type can be inferred from the initializer.

```maple
let x: i32 = 5;          // explicit type
let y = 3.14;             // inferred f32
let s = "hello";          // inferred string
const MAX: i32 = 100;
```

### Type inference rules

The type is inferred from the right-hand side expression:

| Initializer                     | Inferred type         |
|---------------------------------|-----------------------|
| Integer literal (`5`, `-1`)     | `i32`                 |
| Integer literal under `let x: i64` / `let x: u64` | `i64` (same backing lane for both) |
| Float literal (`3.14`, `0.5`)   | `f32`                 |
| Float literal under `let x: f64` | `f64`                 |
| Boolean literal (`true`)        | `bool`                |
| String literal (`"hello"`)      | `string`              |
| Integer array literal (`[1, 2]`)| `i32[]`               |
| Float array literal (`[1.0]`)   | `f32[]`               |
| Cast expression (`x as f32`)    | target type of cast   |
| Struct literal (`{ x = 1 }`)    | matched struct name   |
| Infix expression                | type of its operands  |
| Member access (`p.x`)           | type of that member   |
| Function call (`add(1, 2)`)     | return type of the called function |

When the called function is declared earlier in the same file, the return type is inferred automatically. Imported functions and forward references still require an explicit type annotation.

### Scope and shadowing

Local `let` bindings are block-scoped. A binding may shadow one from an outer block or a function parameter without changing the outer value. Reusing a loop-counter name in a nested loop creates an independent binding.

### Global initialization

Global initializers may reference an earlier global and may contain expressions:

```maple
let base: i32 = 10;
let offset: i32 = base + 5;
```

WebAssembly constant initializers are emitted directly. Initializers that require runtime work are placed in a WebAssembly `start` function and run during module instantiation, in dependency post-order. Global struct fields with literal values remain compile-time data, while expression-valued fields and module-scope dynamic array elements are written by `start`.

An initializer trap is therefore an instantiation failure, before any export can be called:

```js
const module = new WebAssembly.Module(bytes);
const instance = new WebAssembly.Instance(module); // may throw WebAssembly.RuntimeError
```

---

## Functions

Declared with `fn`. Parameters and return type are always explicitly typed.

```maple
fn add(a: i32, b: i32): i32 {
  return a + b;
}

fn greet(): void {
  // no return value
}
```

### Function types and function values

The type `fn(T1, T2, ...): R` describes a callable value. A named function can be assigned to a local binding with a compatible function type and invoked through that binding:

```maple
fn add(a: i32, b: i32): i32 { return a + b; }

fn apply(): i32 {
  let operation: fn(i32, i32): i32 = add;
  return operation(2, 3);
}
```

Indirect calls use a WebAssembly function table and `call_indirect`. A reachable function-typed signature alone does not require the memory allocator; creating a named function reference does, and the compiler includes the allocator only for reachable creation sites. Function-typed bindings are currently local only; module-scope `let` and `const` declarations of function type are rejected. Function types may also use `void`, array types, nested function types, or a multi-return tuple as their return type.

There is not yet an unambiguous type spelling for an array of function references. `fn(i32): i32[]` means a function returning `i32[]`, not an array whose elements have type `fn(i32): i32`. Parenthesized function types such as `(fn(i32): i32)[]` are deferred grammar work.

Lambda syntax, `fn(params): ReturnType { ... }`, is accepted by the parser but rejected by the checker with `function literals are not supported yet`. Function literals are future surface owned by the closures phase.

### Multiple return values

Maple supports Go-style multi-return function signatures and return statements.

```maple
fn swap(a: i32, b: i32): (i32, i32) {
  return b, a;
}
```

Rules:

- Tuple return type syntax must contain at least two types: `(T1, T2, ...)`.
- `void` is not allowed inside tuple return types.
- Multi-return calls are only valid in:
  - destructuring lets: `let (x, y) = swap(1, 2);`
  - pass-through returns in multi-return functions: `return swap(a, b);`
  - statement position (results are dropped): `swap(a, b);`
- Multi-return calls are invalid in single-value positions such as arithmetic, casts, conditions, or single-variable assignment.
- Destructuring supports `_` discards:

```maple
let (x, _) = swap(1, 2);
```

Destructuring constraints:

- Pattern must have at least two entries.
- RHS must be a function call expression.
- Duplicate names in one pattern are rejected (`let (x, x) = ...`).
- `const (x, y) = ...` is not supported.

Functions exported by the entry module are available to the WebAssembly host:

```maple
export fn _start(): i32 {
  return 42;
}
```

---

## Operators

### Arithmetic

`+`, `-`, `*`, `/`, `%`

Integer addition, subtraction, and multiplication wrap at the width of their WebAssembly lane using two's-complement representation. `i32` and `i64` division or remainder by zero traps. Signed division of the minimum lane value by `-1` also traps, while the corresponding signed remainder is defined as `0`.

Arithmetic operands must have compatible types. Integer and float operands, different-width integer operands, and same-width signed/unsigned operands require an explicit cast.

### Comparison

`==`, `!=`, `<`, `<=`, `>`, `>=`

Result type is `bool` (backed by `i32`).

Ordering comparisons follow the arithmetic compatibility rules. `==` and `!=` permit same-lane signed/unsigned integer operands because their bit comparison is sign-independent. Integer/float comparisons require an explicit cast.

### Logical

`&&`, `||`

### Bitwise

`&`, `|`, `^`, `~` (bitwise NOT — prefix), `<<`, `>>`

Same-width signed/unsigned mixing is rejected for `&`, `|`, and `^`. A shift count is exempt from signedness matching; the result follows the left operand's type.

### Prefix

`-` (numeric negation), `!` (logical NOT), `~` (bitwise NOT)

Unary `-` is legal for unsigned integers and wraps in the value's WebAssembly lane.

### Postfix

`++`, `--` — increment/decrement. When used as a statement on a supported variable, member, or index target, no value is left on the stack. In value position, only a plain variable produces its original value before the update. Member and index forms parse but are checker-rejected with `value-position increment requires a plain variable`; broader value-form lvalue increments are undecided.

### Compound assignment

`+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `|=`, `^=`, `<<=`, `>>=`

Compound assignments use the same type and signedness rules as their corresponding binary operators.

### Expression statements

Calls, assignments, and postfix or compound mutations may be used as statements. Other expression statements parse but are permanently checker-rejected with `expression statement has no effect`; Maple does not implicitly discard effect-free values. Assignment is statement-only, so a value-position assignment is rejected with `assignment is a statement`.

### Integer literals

Integer literals are stored losslessly, including values above JavaScript's exact-number range. They are range-checked against their contextual type in declarations, assignments, arguments, returns, struct fields, globals, array elements, compound assignments, and binary expressions. A bare integer literal without a typed context defaults to `i32`.

In an expression with a typed integer operand, a bare literal adopts that operand's type, including signedness. Adoption is recursive, so grouping does not change whether a later signed/unsigned combination is legal. A negative literal cannot adopt an unsigned type.

Prefix minus folds into an integer or float literal, including through parentheses. It does not perform constant propagation: `-(5)` folds, while `-x` remains a runtime negation.

A literal directly beneath `as T` is exempt from range validation because the cast is an explicit wrapping operation. For example, `-1 as u32` produces the `u32` maximum bit pattern.

### Cast

`expr as Type` — explicit type conversion.

```maple
let f: f32 = 5 as f32;
let i: i32 = 3.7 as i32;   // truncates toward zero
let b: u8  = n as u8;       // keeps the low 8 bits
```

Supported conversions:

- Integer-to-float conversion follows the source integer's signedness.
- Float-to-integer conversion truncates toward zero and follows the target integer's signedness. NaN, positive or negative infinity, and values outside the target lane's range trap.
- `i32`/`i64` widening follows the source signedness; narrowing from `i64` to the `i32` lane wraps.
- Integer casts to `u8`/`u16` mask to the low 8/16 bits. Integer casts to `i8`/`i16` keep the low bits and sign-extend them in the `i32` lane.
- Float-to-sub-word casts truncate first and then mask to the low 8/16 bits for both signed and unsigned targets; they do not apply a final sign extension. For example, `-1.5 as i8` produces the `i32`-lane value `255`.
- `f32`/`f64` conversions demote or promote using WebAssembly's floating-point semantics.
- Numeric casts that only change the Maple type while retaining the same full-width WebAssembly lane do not change the bits.

---

## Control flow

### If / else if / else

```maple
if (x > 0) {
  // ...
} else if (x == 0) {
  // ...
} else {
  // ...
}
```

### For loop

```maple
for (let i: i32 = 0; i < 10; i++) {
  // ...
}
```

The init, condition, and update portions use the same expression syntax as the rest of the language.

### While loop

```maple
while (n > 0) {
  n--;
}
```

### Break / continue

`break` exits the innermost loop. `continue` jumps to the next iteration.

### Switch

The selector is evaluated exactly once, then cases are tested in source order through equality checks and conditional branches. Cases do not fall through. Use `break` to exit the switch without returning, or `return` to exit the enclosing function. `continue` inside a switch targets the nearest enclosing loop.

```maple
switch (x) {
  case 0: { return 10; }
  case 1: { return 20; }
  default: { return 99; }
}

// break to exit without returning
switch (x) {
  case 0: { total += x; break; }
  default: { break; }
}
```

---

## Structs

Named record types. Members are typed and separated by commas; a trailing comma is optional.

```maple
struct Point {
  x: i32,
  y: i32,
}
```

### Layout

Struct fields are aligned rather than packed. For example, this struct places `a` at offset 0, pads three bytes, places `b` at offset 4, and has total size 8:

```maple
struct Mixed {
  a: u8,
  b: i32,
}
```

### Struct literals

```maple
let p: Point = { x = 1, y = 2 };
let p = { x = 1, y = 2 };    // type inferred when exactly one struct matches
```

If two or more defined structs have identical field layouts, a struct literal without an annotation is a parse error.

Struct literal field values can be full expressions, not just literals:

```maple
let p: Point = { x = a + 1, y = add(2, 3) };
```

Struct literals are currently legal only as the direct initializer of a local or module-scope binding. Argument, return, and other nested positions parse but are checker-rejected with `struct literals are only supported as initializers`. General inline struct values are undecided.

For **global** struct literals, literal-valued fields are encoded in static data at compile time. Expression-valued fields are initialized once by the WebAssembly `start` function during instantiation.

### Member access

Dot notation reads or writes a member:

```maple
let total: i32 = p.x + p.y;
p.x = 10;
```

All struct variables — local `let` declarations, function parameters, and globals — are memory-backed and accessed via pointer loads and stores. Local structs are allocated on the compiler-managed shadow stack; parameters and globals live in their respective linear-memory regions. See `docs/memory_map.md` for the full layout.

### Equality

`==` compares structs field by field rather than comparing their addresses.

### Struct methods

Methods are declared as dotted functions. The receiver name is in a separate set of parentheses immediately after the dotted name; the receiver type is inferred from the struct name.

```maple
fn Point.sum(p)(): i32 {
  return p.x + p.y;
}

fn Point.scale(p)(factor: i32): i32 {
  return (p.x + p.y) * factor;
}
```

At the call site, `receiver.method(args)` is desugared into a call to the mangled name (`Point_sum`, `Point_scale`) with the receiver prepended as the first argument:

```maple
let s: i32 = p.sum();
let scaled: i32 = p.scale(3);
```

The receiver can be any struct-typed binding — a local `let`, a function parameter, or a global. All structs are memory-backed, so the receiver is always a valid pointer.

---

## Strings

`string` is a built-in first-class type backed by a `{ len: i32, data: *u8 }` header in linear memory. `.len` is the number of UTF-8 bytes, not the number of Unicode code points. String literals are allocated in the static data section at compile time.

```maple
let s: string = "hello";       // explicit annotation
let t = "world";               // inferred string
```

String `==` and `!=` compare the complete byte content and length, not header or data-pointer identity.

### Escapes and UTF-8

String and character literals support exactly these eight escapes:

| Escape | Meaning |
|--------|---------|
| `\n` | newline |
| `\r` | carriage return |
| `\t` | tab |
| `\0` | NUL |
| `\"` | double quote |
| `\'` | single quote |
| `\\` | backslash |
| `\xNN` | code point U+00NN, with exactly two hexadecimal digits |

Hex digits in `\xNN` may use either case. The escape names a Unicode code point, so `\xE9` encodes as the two UTF-8 bytes for `é`, rather than as one raw byte. Astral characters encode as four UTF-8 bytes. Unknown or malformed escapes are lexer errors that name the offending sequence.

### String member access

```maple
let n: i32 = s.len;    // byte length of the string
```

### Strings as parameters

```maple
fn greet(name: string): i32 {
  return name.len;
}
```

String mutability is not settled. The current representation uses writable bytes, and the provisional `string_copy(source, destination)` operation overwrites `min(source.len, destination.len)` bytes without changing either length. Code should not treat this as a permanent string API guarantee.

---

## Memory

**Storage classes.** Every value created in a Maple program has one of three
storage classes.

- **Static** values live for the whole program: module-scope struct, array, and
  string literals, and any local array or string literal whose reference
  *escapes* the function (see *Escaping*, below).
- **Frame** values live until the enclosing function returns: struct literals
  bound by a `let` inside a function, and local array and string literals that
  do not escape. A frame value is created fresh on every call, so writes made by
  one call are not visible to the next.
- **Heap** values live until they are freed: anything from `malloc` or
  `realloc`.

**Aggregates are references.** A struct, array, or string value is a reference
to storage, not a copy of it. `let q = p;` makes `q` and `p` name the same
object, so a write through one is visible through the other, and only one of
them may be freed. Equality (`==`) compares contents, not identity.

**Escaping.** A frame-backed *struct* may not be returned, assigned into a
module-scope global, or stored into a field or element — the frame is released
before the caller sees the pointer, so the value would dangle. Allocate it on
the heap instead:

```maple
fn make(a: i32): Point {
  let p: Point = malloc(8) as Point;   // heap, not a literal
  p.x = a;
  return p;                             // ownership transfers to the caller
}
```

Arrays and strings have no heap constructor, so instead of rejecting an
escaping literal the compiler gives it static storage — `return [7, 8];` and
`return "hello";` compile and behave as before. The analysis is per-function
and follows aliases; it does not cross call boundaries.

**Ownership.** A function that returns a heap pointer transfers ownership to
its caller: the callee allocates, the caller frees. Function parameters are
borrowed — a callee must not free, store, or retain a parameter beyond the
call. A function that consumes an argument says so in its name (a `consume_` or
`take_` prefix) and in its first documentation line. Module-scope globals never
own; assigning a heap pointer into a global is the documented way to leak.

**`defer`.** `defer f(args);` runs `f` when the innermost enclosing block is
left, by any edge — falling off the end, `break`, `continue`, or `return`.
Deferred calls in the same block run in reverse registration order, and inner
blocks run before outer ones. The arguments and the function value are
evaluated at the `defer` statement, not at the call, so reassigning a variable
afterwards does not change what runs. A `defer` may only be a function call,
and only inside a function body. A program that uses no `defer` compiles to
byte-identical output.

```maple
fn work(): i32 {
  let p: i32 = malloc(64);
  defer free(p);        // runs on every exit edge below
  if (bad(p)) { return -1; }
  return use(p);
}
```

**Freeing.** `free(p)` releases a heap block and accepts either an `i32` or a
struct-typed value. `free(0)` does nothing. Passing a pointer that is not a
live heap allocation — a literal, a frame-backed value, an interior pointer, or
an already-freed block — traps. Freeing the same pointer twice, or using a
pointer after freeing it, is undefined behavior; where the compiler can see it,
it is a compile error instead.

`realloc(p, new_size)` derives the old size from the allocation itself. It
returns 0 on failure and leaves `p` valid; on success `p` is freed, so a
`defer free(p)` registered earlier now names a stale pointer — defer after the
last `realloc`, or re-defer.

**Debugging allocations.** Importing from `"memory_debug"` instead of
`"memory"` swaps in an instrumented allocator with the same public surface plus
`heap_stats()` and `heap_errors()`. It poisons freed payloads and records
invalid frees rather than trapping, so a run can report how many it saw.

**Traps.** A trap ends the current call and leaves the module's memory, heap,
and stack in an unspecified state. Deferred calls do not run. The host must
discard the instance; Maple makes no guarantee about any later call into it.

**Null.** There is no null literal. `0` is the null pointer and `0 as T` is how
it is written. Dereferencing it does not trap — address 0 is ordinary memory —
so code that may hold a null pointer must test it.

---

## Imports

Names from other modules are imported at the top of a file:

```maple
import add from "./math.maple"
import malloc, free from "memory"
```

Imported functions are checked against the exported Maple declaration, including argument count and parameter types. A function imported from another Maple source module may also be assigned to a compatible function-typed local and called indirectly.

Exported structs may be imported and used in annotations, literals, member reads and writes, parameters, return values, and structural `==` comparisons:

```maple
import Pair from "./types.maple"
import keep_pair from "./consumer.maple"

let value: Pair = { left = 2, right = 3 };
let returned: Pair = keep_pair(value);
```

Struct identity is nominal across modules. Two structs with the same name and field layout remain distinct when defined by different modules; type diagnostics qualify such names with their defining module.

The bundled standard-library modules are Maple source files under `src/compiler/stdlib/` and pass through the same merged compilation pipeline as user modules.

### Math standard library (`"math"`)

The bundled `"math"` module exports Tier 1 wrappers (WASM opcodes such as `sqrt`, `floor`, `abs_f32`, `abs_i32`, and `f64` mirrors `sqrt_f64`, `abs_f64`, …) and Tier 2 approximations (`sin`, `cos`, `tan`, `atan2`, `pow`, `fmod`). Constants `PI`, `TWO_PI`, `HALF_PI`, and `E` are **`f32` globals** — import them like functions, but use them as plain identifiers (they are not calls):

```maple
import sin, sqrt, PI, HALF_PI from "math"

export fn sample(t: f32): f32 {
  return sin(t * HALF_PI);
}
```

Tier 2 functions use range reduction and short polynomials; expect roughly **1e-3** accuracy on spot checks, not full IEEE semantics. Imported globals are immutable in Maple (`cannot assign to imported global`).

### Memory standard library (`"memory"`)

The bundled `"memory"` module exports `malloc`, `free`, and `realloc` to other Maple modules. When the allocator is included, the compiler places `__heap_init(align8(finalDataEnd))` first in the WebAssembly `start` function. It runs during module instantiation, before other deferred initializers and before any export can be called.

`__heap_init` is exported so the compiler can discover it, but it is **not importable by user code**: the import checker rejects `__`-prefixed stdlib names, because resetting the allocator invalidates every pointer a program is holding. `"memory_debug"` provides the same surface plus `heap_stats()` and `heap_errors()`.

### String standard library (`"string"`)

The provisional `string_copy(source, destination)` operation is exported by the bundled `"string"` module and imported with `import string_copy from "string"`. Its behavior is described in [Strings](#strings).

---

## Exports

`export` makes a declaration available to other Maple modules that import it. Only exports declared by the entry module are placed in the final WebAssembly export section and made available to the host; exports from dependency and standard-library modules remain internal to the merged program.

```maple
export fn add(a: i32, b: i32): i32 {
  return a + b;
}

export let counter: i32 = 0;
```

---

## Whole-program tree shaking

Maple parses and type-checks every module before whole-program reachability is computed, so an error in unreachable code is still reported. Emission then removes unreachable functions, globals, function-table entries, runtime helpers, and literal data. A dependency's unused export does not become reachable merely because it is marked `export`; only entry-module exports form host-visible roots.

---

## Type checker

Maple performs a static type-checking pass after parsing. Errors are reported with file, line, and column information. The following checks are enforced:

1. **Assignment compatibility** — the type of the initializer or RHS must be compatible with the declared type of the variable.
2. **Function return type** — every `return` statement is checked against the declared return type; a value-returning function must return a value; a void function must not.
3. **Numeric compatibility** — incompatible lane widths, integer/float mixing, and signed/unsigned combinations that are not explicitly exempt require a cast.
4. **Call argument count and types** — the number and types of arguments at a call site must match the declaration.
5. **Struct member existence** — member access on a known struct type errors if the member does not exist.
6. **Const mutation** — assigning to a `const` binding, or writing through a member/index expression rooted in a `const` binding, is an error.
7. **Struct literal field validation** — unknown fields, missing required fields, and field type mismatches are compile-time errors.
8. **Integer literal ranges** — literals are checked against the type required by their surrounding expression.
9. **Array literal elements** — every element is checked for compatibility with the declared element type; nested array literals remain unsupported.
10. **Function values** — function signatures, indirect-call arity, and function-type assignments are checked.
11. **Resolved calls and value shapes** — an unknown callee reports `Undefined function '<name>'`; a void call used where a value is required reports `void call used as a value`.
12. **Member and index totality** — scalar member access reports `type 'T' has no members`, indexing a non-array reports `type 'T' is not indexable`, and indexes outside the WebAssembly `i32` lane report `array index must be an i32-lane value`. `u32`, sub-word integers, and `bool` remain valid indexes because they use the `i32` lane; `i64`, `u64`, `f32`, and `f64` do not.
13. **Operator domains** — arithmetic, negation, and increment/decrement require numeric operands and report `operator 'OP' requires numeric operands`; bitwise and shift operators require integer operands and report `operator 'OP' requires integer operands`. Compound assignments use the same domain checks.
14. **Declaration totality** — unknown annotations and cast targets report `unknown type 'T'`; a non-void function that can fall through reports `function 'f' must return 'T' on all paths`. A binding's initializer resolves in the surrounding scope before the new binding enters scope.
15. **Mutation and statement positions** — assignments require an lvalue, are valid only as statements, preserve assignment compatibility and `const` checks, and report `invalid assignment target` or `assignment is a statement` for those respective violations.

---

## Grammar (formal)

```
Program       := TopStmt*

TopStmt       := ImportDecl
               | 'export'? FnDecl
               | 'export'? LetDecl
               | 'export'? ConstDecl
               | 'export'? StructDecl

ImportDecl    := 'import' Ident (',' Ident)* 'from' StringLit

FnDecl        := 'fn' FnName '(' Params? ')' ':' RetType Block
FnName        := Ident                                    -- plain function
               | Ident '.' Ident '(' Ident ')'           -- method (struct.method(receiver))

Params        := Param (',' Param)*
Param         := Ident ':' Type
RetType       := Type | MultiRetType
MultiRetType  := '(' Type ',' Type (',' Type)* ','? ')'

StructDecl    := 'struct' Ident '{' StructFields? '}'
StructFields  := StructField (',' StructField)* ','?
StructField   := Ident ':' Type

LetDecl       := 'let' Ident (':' Type)? '=' Expr ';'
               | 'let' Destructure '=' CallExpr ';'      -- local scope only
ConstDecl     := 'const' Ident (':' Type)? '=' Expr ';'
Destructure   := '(' PatternName ',' PatternName (',' PatternName)* ','? ')'
PatternName   := Ident | '_'

Block         := '{' Stmt* '}'
Stmt          := LetDecl
               | ConstDecl
               | ReturnStmt
               | BreakStmt
               | ContinueStmt
               | IfStmt
               | ForStmt
               | WhileStmt
               | SwitchStmt
               | Expr ';'

ReturnStmt    := 'return' (Expr (',' Expr)* ','?)? ';'
BreakStmt     := 'break' ';'
ContinueStmt  := 'continue' ';'

IfStmt        := 'if' '(' Expr ')' Block ('else' 'if' '(' Expr ')' Block)* ('else' Block)?
ForStmt       := 'for' '(' LetDecl Expr ';' Expr ')' Block
WhileStmt     := 'while' '(' Expr ')' Block
SwitchStmt    := 'switch' '(' Expr ')' '{' CaseClause* DefaultClause? '}'
CaseClause    := 'case' IntLit ':' Block
DefaultClause := 'default' ':' Block

Expr          := AssignExpr

AssignExpr    := Ident AssignOp Expr
               | Ident '[' Expr ']' AssignOp Expr
               | Ident '.' Ident AssignOp Expr
               | CastExpr

AssignOp      := '=' | '+=' | '-=' | '*=' | '/=' | '%='
               | '&=' | '|=' | '^=' | '<<=' | '>>='

CastExpr      := InfixExpr ('as' Type)*

InfixExpr     := UnaryExpr (InfixOp UnaryExpr)*

InfixOp       := '+' | '-' | '*' | '/' | '%'
               | '==' | '!=' | '<' | '<=' | '>' | '>='
               | '&&' | '||'
               | '&' | '|' | '^' | '<<' | '>>'

UnaryExpr     := PrefixOp UnaryExpr
               | PostfixExpr

PrefixOp      := '-' | '!' | '~'

PostfixExpr   := CallExpr ('++'  | '--')?

CallExpr      := PrimaryExpr ('(' Args? ')' | '[' Expr ']' | '.' MemberName)*
MemberName    := Ident

Args          := Expr (',' Expr)*

PrimaryExpr   := IntLit | FloatLit | BoolLit | StringLit
               | ArrayLit | StructLit
               | LambdaExpr
               | Ident
               | '(' Expr ')'

ArrayLit      := '[' (Expr (',' Expr)*)? ']'
StructLit     := '{' StructInit (',' StructInit)* ','? '}'
StructInit    := Ident '=' Expr
LambdaExpr    := 'fn' '(' Params? ')' ':' RetType Block

Type          := ScalarType
               | Ident          -- user-defined struct
               | FnType
               | Type '[]'      -- array of Type

ScalarType    := 'void' | 'bool' | 'string'
               | 'i8' | 'u8' | 'i16' | 'u16'
               | 'i32' | 'u32' | 'i64' | 'u64'
               | 'f32' | 'f64'

FnType        := 'fn' '(' TypeList? ')' ':' RetType
TypeList      := Type (',' Type)* ','?
```
