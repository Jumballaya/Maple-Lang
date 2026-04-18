# Maple Demo Programs

Each folder contains a `main.maple` entrypoint showing one major language area.

- `01_functions_imports`: function declarations, exports, file imports, including **`i64`** callee across modules (`II_I` / `(param i64 i64) (result i64)` at link time)
- `02_variables_arithmetic`: let bindings, assignment, ints/floats, arithmetic, plus **i64**, **u32/u64** unsigned ops, and **f64** remainder
- `03_control_flow`: if/else, for loops, while loops, and break
- `04_structs_members`: struct declarations, struct literals, member access, and a struct with an **i64** field (wider load/store)
- `05_arrays_indexing`: array literals and index expressions
- `06_stdlib_memory`: stdlib import usage (`malloc`, `free`)
- `07_operators_assignments`: binary/prefix/postfix operators and compound assignments
- `08_casting`: i32/f32 casts and **i32↔i64**, **f32↔f64** widening/narrowing
- `13_multi_return`: multi-return functions, destructuring `let (a, b) = call()`, `_` discards, and pass-through `return call();`
- `99_everything`: combined example using most implemented compiler features (includes a **64-bit** snippet)

## Compile Example

```bash
npm start -- demo/03_control_flow/main.maple -o out
```

## Run Example (with wasmtime)

```bash
wasmtime --invoke _start ./out 8
```
