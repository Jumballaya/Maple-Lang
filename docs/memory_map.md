```
+------------------------------+  0x0000_0000
|                              |
|   Shadow stack               |  wasm-ld software stack, grows downward
|   (64 KB, one full page)     |  __stack_pointer initialised to 0x1_0000
|                              |
+------------------------------+  0x0001_0000  (65536)  ← __global_base
|                              |
|   Static data                |  array literals, struct literals,
|   (compiler data section)    |  string bytes, string header records
|                              |  allocated upward from 0x1_0000
+------------------------------+  HEAP_BASE  (= 0x1_0000 + static_data_size, aligned to 8)
|                              |
|   Heap                       |  malloc / free arena, grows upward
|   (free/used blocks w/ hdr)  |
|                              |
+------------------------------+  heap_end (logical top, grows on demand)
|                              |
|   Unused                     |
|                              |
+------------------------------+  memory.size × 64 KiB  (default: 2 pages = 128 KB)
```

## Notes

- `wasm-ld` defaults to `--stack-first`: the shadow stack occupies the first page
  ([0, 65536)) and `__global_base = 65536`. Static data therefore starts at 65536.
- The Maple compiler's `dataPtr` starts at **65536** (`ModuleBuilder.dataPtr`) so that
  the `i32.const` addresses embedded in emitted code match the addresses the linker
  assigns. If `dataPtr` were lower (e.g. 1024) the linker would relocate the data
  segment upward while leaving code references unchanged, causing silent wrong reads.
- Maple programs never use the shadow stack (all locals are native WebAssembly locals),
  so the 64 KB reservation has no runtime cost.
- The heap is initialised lazily; programs that do not call `malloc` never touch it.
