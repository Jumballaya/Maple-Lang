# Linking modules

## Toolchain:

- wat2wasm
  - via [https://github.com/WebAssembly/wabt](WABT)
- wasm-ld
  - via [https://github.com/emscripten-core/emscripten](Emscripten)

## Build process:

- 1. Build modules into .o files (binary .wasm files waiting to be linked)
  - Each module must be built with --relocatable to mark that it can be linked
  - Command: `wat2wasm -r {.wat} -o {.o}`
  - These binaries can be pre-built and waiting to be linked to save time
- 2. Build main entry file and any user .o files with the -r flag, just like in step 1
  - This happens every build, eventually there could be a cache
- 3. Link all of the prebuilt modules together with all of the freshly built user modules
  - Command: `wasm-ld --no-entry {*.o} -o {.wasm}`

## Example

### High level code

In the following example we have 2 module files and we are importing a function from module a into module b.

---

**a.maple**

```
export fn a(n: i32): i32 {
  return n + 10;
}
```

**b.maple**

```
import a from "a.maple"

export fn b(b: i32): i32 {
  return a(b + 32);
}
```

### WAT compilation

At the `.wat` level you can see that the import statement turns into:

```ts
(type $a_type (func (param i32) (result i32)))
(import "env" "a" (func $a (type $a_type)))
```

this transform the imported function into 2 part: the type declaration and the import statement. Modules must capture exported function data to matach this.

---

**mod_a.wat**

```ts
(module
  (func $a (export "a") (param $n i32) (result i32)
    (i32.add (local.get $n) (i32.const 10))
  )
)
```

**mod_b.wat**

```ts
(module

  (type $a_type (func (param i32) (result i32)))
  (import "env" "a" (func $a (type $a_type)))

  (func $main (export "b") (param $n i32) (result i32)
    (call $a (i32.add (local.get $n) (i32.const 32)))
  )
)
```
