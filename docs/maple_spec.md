# Maple Language Specification

## Overview

Maple is a statically-typed, compiled language that targets WebAssembly. Source files are compiled to `.wat` (WebAssembly Text Format), assembled to relocatable `.o` objects with `wat2wasm`, and linked into a final `.wasm` binary with `wasm-ld`.

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

All integer variants smaller than `i32` are represented in the WebAssembly `i32` lane. An explicit cast to a sub-word type masks or sign-extends the value to that type's width.

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

Array literal elements must currently be literals. Integer and float literals adopt the declared element type and are range-checked against it, so `let values: i64[] = [1, 2];` is valid. Expression elements such as `[x, f(2)]` are rejected until runtime element initialization is implemented.

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

WebAssembly constant initializers are emitted directly. Initializers that require runtime work are placed in a guarded prologue. The prologue runs once, immediately before the body of the first exported function that is called; it does not run merely because the module was instantiated. Global struct fields with literal values remain compile-time data, while expression-valued fields are written by this prologue.

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

Indirect calls use a WebAssembly function table and `call_indirect`. Function-typed bindings are currently local only; module-scope `let` and `const` declarations of function type are rejected. Function types may also use `void`, array types, nested function types, or a multi-return tuple as their return type.

Lambda syntax, `fn(params): ReturnType { ... }`, is accepted by the parser.

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

Exported functions are available to the WebAssembly host:

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

`++`, `--` — increment/decrement. When used as a statement, no value is left on the stack. When used as a sub-expression (rvalue), the original value is produced before the update.

### Compound assignment

`+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `|=`, `^=`, `<<=`, `>>=`

Compound assignments use the same type and signedness rules as their corresponding binary operators.

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
- Casts to `u8`/`u16` mask to the low 8/16 bits. Casts to `i8`/`i16` keep the low bits and sign-extend them in the `i32` lane.
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

Integer dispatch via `br_table`. Each case body is a block. Cases do not fall through. Use `break` to exit the switch without returning, or `return` to exit the enclosing function. `continue` inside a switch targets the nearest enclosing loop.

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

For **global** struct literals, literal-valued fields are encoded in static data at compile time. Expression-valued fields are initialized at runtime once, guarded by a compiler-generated flag before exported function bodies execute.

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

## Imports

Names from other modules are imported at the top of a file:

```maple
import add from "./math.maple"
import malloc, free from "memory"
```

Imported names are usable as function calls. The type system uses a signature encoding to check arity at call sites; full type checking of imported functions is limited to argument count.

When a module links against known import metadata, function signatures are encoded as `params_return` where each letter is one lane:

| Letter | Meaning |
|--------|---------|
| `i` | `i32` |
| `I` | `i64` |
| `f` | `f32` |
| `F` | `f64` |
| `v` | no parameter or no return (`void`) |

Example: `ii_i` is `(i32, i32) -> i32`; `I_I` is `(i64) -> i64`; `v_F` is `() -> f64`.

### Math standard library (`"math"`)

The bundled `"math"` module exports Tier 1 wrappers (WASM opcodes such as `sqrt`, `floor`, `abs_f32`, `abs_i32`, and `f64` mirrors `sqrt_f64`, `abs_f64`, …) and Tier 2 approximations (`sin`, `cos`, `tan`, `atan2`, `pow`, `fmod`). Constants `PI`, `TWO_PI`, `HALF_PI`, and `E` are **`f32` globals** — import them like functions, but use them as plain identifiers (they are not calls):

```maple
import sin, sqrt, PI, HALF_PI from "math"

export fn sample(t: f32): f32 {
  return sin(t * HALF_PI);
}
```

Tier 2 functions use range reduction and short polynomials; expect roughly **1e-3** accuracy on spot checks, not full IEEE semantics. Imported globals are immutable in Maple (`cannot assign to imported global`).

---

## Exports

`export` on a function or variable makes it available to the WebAssembly host and to other modules that import it:

```maple
export fn add(a: i32, b: i32): i32 {
  return a + b;
}

export let counter: i32 = 0;
```

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
9. **Array literal elements** — unsupported expressions, mixed literal kinds, and element-type mismatches are rejected.
10. **Function values** — function signatures, indirect-call arity, and function-type assignments are checked.

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
