# Maple Demo Programs

Each folder contains a `main.maple` entrypoint showing one major language area.

- `01_functions_imports`: function declarations, exports, and file imports
- `02_variables_arithmetic`: let bindings, assignment, ints/floats, and arithmetic
- `03_control_flow`: if/else, for loops, while loops, and break
- `04_structs_members`: struct declarations, struct literals, and member access
- `05_arrays_indexing`: array literals and index expressions
- `06_stdlib_memory`: stdlib import usage (`malloc`, `free`)
- `99_everything`: combined example using most implemented compiler features

## Compile Example

```bash
npm start -- demo/03_control_flow/main.maple -o out
```

## Run Example (with wasmtime)

```bash
wasmtime --invoke _start ./out 8
```
