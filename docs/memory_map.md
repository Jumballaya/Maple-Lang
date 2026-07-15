```
+------------------------------+  0x0000_0000
|                              |
|   Shadow stack               |  compiler-managed software stack, grows downward
|   (64 KB, one full page)     |  $__sp initialised to 0x1_0000 (65536)
|                              |  used for local struct variables in functions
|                              |
+------------------------------+  0x0001_0000  (65536)  ← __global_base
|                              |
|   Static data                |  array literals, global struct literals,
|   (compiler data section)    |  string bytes + string header records
|                              |  allocated upward from 0x1_0000 at compile time
+------------------------------+  HEAP_BASE  (= 0x1_0000 + static_data_size, aligned to 8)
|                              |
|   Heap                       |  malloc / free arena, grows upward at runtime
|   (free/used blocks w/ hdr)  |  free-list allocator with 8-byte chunk headers
|                              |  coalesces adjacent free blocks on free()
+------------------------------+  heap_end (logical top, grows on demand via memory.grow)
|                              |
|   Unused                     |
|                              |
+------------------------------+  memory.size × 64 KiB  (static data + at least one heap page)
```

## Regions

### Shadow stack  (0x0000_0000 – 0x0000_FFFF)

The compiler emits a mutable global `$__sp` (stack pointer) initialised to `65536`. Every function that declares one or more local struct variables adjusts `$__sp` in its prologue and epilogue:

```wat
;; prologue — allocate frame
(global.set $__sp (i32.sub (global.get $__sp) (i32.const <frame_size>)))

;; epilogue — release frame (fall-through path)
(global.set $__sp (i32.add (global.get $__sp) (i32.const <frame_size>)))
```

Explicit `return` statements also restore `$__sp` before returning. If the return expression itself could call other functions (which would allocate their own frames), the value is first saved into a `$__ret_tmp` local so that the frame can be released without corrupting the returned data.

Each local struct variable gets a single `i32` pointer local that is set to `$__sp + offset` in the prologue. Field reads and writes are emitted as `i32.load`/`f32.load` and `i32.store`/`f32.store` instructions against that pointer.

`break` and `continue` do **not** touch `$__sp` — they only exit the current loop, not the function, so the frame is still live.

### Static data  (0x0001_0000 – HEAP_BASE)

Compile-time-only. The compiler's `dataPtr` cursor starts at `65536` and allocates space upward for:

- **Array literals** — element bytes packed contiguously, followed by an 8-byte `{ len: i32, data: *element }` header; the array value points to the header
- **Global struct literals** — field bytes packed contiguously; the global variable holds the address as an `i32`
- **String literals** — a padded UTF-8 byte run followed immediately by an 8-byte `{ len: i32, data: *u8 }` header; the `string` variable holds the header address

Local struct literals (declared inside function bodies) are **not** placed here — they live on the shadow stack.

When a global struct field uses an expression (for example `{ x = other + 1 }`), the compiler writes a zero placeholder in static data and emits a one-time runtime store guarded by `$__globals_inited`. Literal-valued fields remain fully compile-time encoded.

`dataPtr` starts at `65536` so the first WebAssembly page remains reserved for
the compiler-managed shadow stack. Static addresses baked into emitted code use
the same whole-program layout.

### Heap  (HEAP_BASE – heap_end)

Runtime-managed by the Maple stdlib module (`src/compiler/stdlib/memory.maple`). The allocator is a free-list allocator:

- Each chunk has an **8-byte header** `{ next: i32, size_and_flags: u32 }` where `size` is 8-aligned and bit 0 is the `ALLOC` flag.
- `malloc(n)` — scans the free list for a fit, splits oversized blocks, or carves from the wilderness; returns a pointer to the payload (header + 8).
- `free(ptr)` — marks the block free, coalesces with the next block if it is also free, and reclaims the wilderness top if the freed block is at `heap_end`.
- `realloc(old, old_size, new_size)` — `malloc` + `memory.copy` + `free`.
- `memory.grow` is called automatically when `malloc` needs more capacity.
- Merged programs call `heap_init(align8(finalDataEnd))` as the first one-time startup initializer, placing the heap above all static data.
- `heap_init(data_end)` is exported for explicit resets. It discards the free list and resets the wilderness to `align8(data_end)`, invalidating every allocation returned before the call.
- Unwired single-module and direct-harness instances initialize lazily at `131072` on their first `malloc` call.

Programs that never call `malloc` never touch the heap region.

## Notes

- Maple reserves the first page for the shadow stack and begins merged static
  data at `65536`.
- The shadow stack grows **down** and the heap grows **up**. They could theoretically collide if a program has deeply recursive functions with many large struct locals and simultaneously performs heavy heap allocation. No overflow detection is currently implemented.
- The static data region is fixed during whole-program emission and never
  changes at runtime.
- The runtime memory import declares `max(2, ceil(finalDataEnd / 65536) + 1)` initial pages, reserving enough room for static data and one heap page. `memory.grow` requests additional pages as needed.
