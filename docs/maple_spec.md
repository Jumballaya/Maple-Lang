# Maple Language Specification

## Overview

Maple is a statically-typed, compiled language that targets WebAssembly. Source files are compiled to `.wat` (WebAssembly Text Format), assembled to relocatable `.o` objects with `wat2wasm`, and linked into a final `.wasm` binary with `wasm-ld`.

---

## Comments

Single-line only. No block comment syntax.

```maple
// this is a comment
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

All integer variants smaller than `i32` are represented as `i32` in WebAssembly.

### Special types

| Type     | Description                                      |
|----------|--------------------------------------------------|
| `void`   | Used as a function return type meaning no return value |
| `string` | First-class string type. Backed by a `{ len: i32, data: *u8 }` header in linear memory. |

### Arrays

A type followed by `[]` denotes an array. Array literals are allocated in the data section.

```maple
let nums: i32[] = [1, 2, 3];
let floats: f32[] = [1.0, 2.0, 3.0];
```

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
| Float literal (`3.14`, `0.5`)   | `f32`                 |
| Boolean literal (`true`)        | `bool`                |
| String literal (`"hello"`)      | `string`              |
| Integer array literal (`[1, 2]`)| `i32[]`               |
| Float array literal (`[1.0]`)   | `f32[]`               |
| Cast expression (`x as f32`)    | target type of cast   |
| Struct literal (`{ x = 1 }`)    | matched struct name   |
| Infix expression                | type of its operands  |
| Member access (`p.x`)           | type of that member   |

Calling a function without an explicit annotation is an error — function return type inference is not supported.

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

Both operands must have the same WASM-level type. Mixing `i32` and `f32` without a cast is a type error.

### Comparison

`==`, `!=`, `<`, `<=`, `>`, `>=`

Result type is `bool` (backed by `i32`).

### Logical

`&&`, `||`

### Bitwise

`&`, `|`, `^`, `~` (bitwise NOT — prefix), `<<`, `>>`

### Prefix

`-` (numeric negation), `!` (logical NOT), `~` (bitwise NOT)

### Postfix

`++`, `--` — increment/decrement. When used as a statement, no value is left on the stack. When used as a sub-expression (rvalue), the original value is produced before the update.

### Compound assignment

`+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `|=`, `^=`, `<<=`, `>>=`

### Cast

`expr as Type` — explicit type conversion.

```maple
let f: f32 = 5 as f32;
let i: i32 = 3.7 as i32;   // truncates toward zero
let b: u8  = n as u8;       // same WASM representation, no-op at runtime
```

Supported conversions:
- `i32` → `f32`: emits `f32.convert_i32_s`
- `f32` → `i32`: emits `i32.trunc_f32_s` (truncates toward zero)
- Any numeric type to another numeric type sharing the same WASM backing type (e.g. `i32` → `u8`): no-op at runtime
- Struct pointer → struct pointer: no-op at runtime

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

Integer dispatch via `br_table`. Each case must end with a `return`.

```maple
switch (x) {
  case 0: return 10;
  case 1: return 20;
  default: return 99;
}
```

---

## Structs

Named record types. Members are typed and separated by commas (trailing comma required).

```maple
struct Point {
  x: i32,
  y: i32,
}
```

### Struct literals

```maple
let p: Point = { x = 1, y = 2 };
let p = { x = 1, y = 2 };    // type inferred when exactly one struct matches
```

If two or more defined structs have identical field layouts, a struct literal without an annotation is a parse error.

### Member access

Dot notation reads or writes a member:

```maple
let total: i32 = p.x + p.y;
p.x = 10;
```

Local struct variables (`let` declarations in a function body) have their members flattened into separate WASM locals. Struct parameters and global struct variables are memory-backed and accessed via pointer loads.

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

The receiver must be a pointer-backed struct (function parameter or global), not a flattened local.

---

## Strings

`string` is a built-in first-class type backed by a `{ len: i32, data: *u8 }` header in linear memory. String literals are allocated in the data section at compile time.

```maple
let s: string = "hello";       // explicit annotation
let t = "world";               // inferred string
```

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

---

## Imports

Names from other modules are imported at the top of a file:

```maple
import add from "./math.maple"
import malloc, free from "memory"
```

Imported names are usable as function calls. The type system uses a signature encoding to check arity at call sites; full type checking of imported functions is limited to argument count.

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
3. **Mixed arithmetic** — both operands of `+`, `-`, `*`, `/`, `%` must have the same WASM-level type.
4. **Call argument count and types** — the number and types of arguments at a call site must match the declaration.
5. **Struct member existence** — member access on a known struct type errors if the member does not exist.
6. **Const mutation** — assigning to a `const` binding, or writing through a member/index expression rooted in a `const` binding, is an error.

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
RetType       := Type

StructDecl    := 'struct' Ident '{' StructField* '}'
StructField   := Ident ':' Type ','

LetDecl       := 'let' Ident (':' Type)? ('=' Expr)? ';'
ConstDecl     := 'const' Ident ':' Type '=' Expr ';'

Block         := '{' Stmt* '}'
Stmt          := LetDecl
               | ConstDecl
               | ReturnStmt
               | IfStmt
               | ForStmt
               | WhileStmt
               | SwitchStmt
               | Expr ';'

ReturnStmt    := 'return' Expr? ';'

IfStmt        := 'if' '(' Expr ')' Block ('else' 'if' '(' Expr ')' Block)* ('else' Block)?
ForStmt       := 'for' '(' LetDecl Expr ';' Expr ')' Block
WhileStmt     := 'while' '(' Expr ')' Block
SwitchStmt    := 'switch' '(' Expr ')' '{' CaseClause* DefaultClause? '}'
CaseClause    := 'case' IntLit ':' ReturnStmt
DefaultClause := 'default' ':' ReturnStmt

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

CallExpr      := PrimaryExpr ('(' Args? ')' | '[' Expr ']' | '.' Ident)*

Args          := Expr (',' Expr)*

PrimaryExpr   := IntLit | FloatLit | BoolLit | StringLit
               | ArrayLit | StructLit
               | Ident
               | '(' Expr ')'

ArrayLit      := '[' (Expr (',' Expr)*)? ']'
StructLit     := '{' StructInit (',' StructInit)* ','? '}'
StructInit    := Ident '=' Expr

Type          := 'void' | 'bool' | 'string'
               | 'i8' | 'u8' | 'i16' | 'u16'
               | 'i32' | 'u32' | 'i64' | 'u64'
               | 'f32' | 'f64'
               | Ident          -- user-defined struct
               | Type '[]'      -- array of Type
```
