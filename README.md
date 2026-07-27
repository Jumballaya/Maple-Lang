# Maple

WASM first programming language

## Installation

Install the project dependencies:

```bash
npm install
```

No system WebAssembly toolchain is required. The project uses the `wat2wasm`
binary supplied by its `wabt` development dependency only for the permanent
WAT-vs-binary cross-check tests. npm scripts add that bin shim to `PATH`;
running the cross-check file directly outside npm can silently skip it when the
shim is unreachable. CI sets `MAPLE_REQUIRE_WAT2WASM=1` to prevent that skip.
The compiler itself has no runtime npm dependencies or external-tool
requirements.

## Compilation pipeline

The compiler parses the entry module and its dependency graph, type-checks and
annotates each module, merges the whole program, lowers it to typed IR, runs the
IR pass hook, validates the IR, and emits the final `.wasm` bytes directly.
WAT and IR text are optional debug artifacts derived from the same validated
module.

## Usage

You can run via `npm start -- <your_entry_file>`

```bash
Usage: maple [options] <file>
Compiles a maple source code file into a .wasm file

Options:
  -o, --output <file>   Specify output file (default: build/app.wasm)
  --import-memory       Import runtime.memory instead of exporting owned memory
  --emit-wat <file>     Also write WebAssembly text (debug output)
  --emit-ir <file>      Also write the lowered IR as JSON (debug output)
  --strip               Omit the name section from the .wasm output

Examples:
  maple src/main.maple
  maple src/main.maple -o app.wasm
  maple --import-memory src/main.maple
```

`--emit-wat` and `--emit-ir` are unstable debugging surfaces with no
compatibility promise. `--strip` removes the name section from the binary while
leaving the optional debug artifacts unchanged.

## Host memory

Compiled modules own and export their linear memory by default, so they need no
import object:

```js
const { instance } = await WebAssembly.instantiate(bytes);
const memory = instance.exports.memory;
```

Use `--import-memory` when the host needs to provide a shared or pre-sized
memory. The host memory's initial size must meet the minimum declared by the
compiled module:

```js
const memory = new WebAssembly.Memory({ initial: requiredInitialPages });
const { instance } = await WebAssembly.instantiate(bytes, {
  runtime: { memory },
});
```

## Examples

### Demo 1 -- imports

- Files: `demo/01_functions_imports/main.maple`,
  `demo/01_functions_imports/math.maple`

**main.maple**

```ts
import add, add64 from "./math.maple"

export fn _start(a: i32, b: i32): i32 {
  let lo: i32 = add(a, b);
  let hi: i64 = add64(a as i64, b as i64);
  return lo + (hi as i32);
}
```

**math.maple**

```ts
export fn add(a: i32, b: i32):i32 {
  return a + b;
}

export fn add64(a: i64, b: i64): i64 {
  return a + b;
}
```

To compile, run `npm start -- demo/01_functions_imports/main.maple`. The output
is written to `build/app.wasm` unless `-o` specifies another path.

# Language Features

## Imports

Import any exported function, struct or global variable from the module. You can import via a local file, or using the builtin stdlib.

```ts
import _fn, _struct, _global from "./local/path.maple"
import single from "stdlib"
```

## Exports

Functions, structs and global variables can be exported. You can only export from the module's global scope, and not from inside a function. You can just put 'export' in front of the declaration.

```ts
// global variable
export let PI: f32 = 3.1415926535;

// struct
export struct vec2 {
  x: f32,
  y: f32
}

// function
export fn add_vec2(a: vec2, b: vec2): vec2 {
  let v: vec2 = malloc(vec2);
  v.x = a.x + b.x;
  v.y = a.y + b.y;
  return v;
}
```
