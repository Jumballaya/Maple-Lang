# Maple

WASM first programming language

## Installation

- 1. You must have the following installed
  - wat2wasm
    - via [https://github.com/WebAssembly/wabt](WABT)
  - wasm-ld
    - via [https://github.com/emscripten-core/emscripten](Emscripten)
- 2. Set up the project: `npm install`

## Usage

You can run via `npm start -- <your_entry_file>`

```bash
Usage: maple <file> [optional_arg]
Compiles a maple source code file into a .wasm file

Options:
  -o, --output <file>   Specify output file (default: <input>.wasm)

Examples:
  maple src/main.maple
  maple src/main.maple -o app.wasm
```

## Examples

### Demo 1 -- imports

- Files: `demo/demo1/main.maple`, `demo/demo1/test.maple`

**main.maple**

```ts
import add from "./test.maple"

export fn _start(a: i32, b: i32): i32 {
  return add(a, b);
}
```

**test.maple**

```ts
export fn add(a: i32, b: i32):i32 {
  return a + b;
}
```

To compile, run: `npm start -- demo/demo1/main.maple` and you will find your `app.wasm` in the build folder that was created.

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
