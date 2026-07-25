```
+------------------------------+  0x0000_0000
|                              |
|   Shadow stack               |  compiler-managed software stack, grows downward
|   (64 KB, one full page)     |  $__sp initialised to 0x1_0000 (65536)
|                              |  used for local struct variables in functions
|                              |
+------------------------------+  0x0001_0000  (65536)  ← static-data base
|                              |
|   Static data                |  array/string literals, global struct literals,
|   (compiler data section)    |  including literals declared inside functions
|                              |  allocated upward from 0x1_0000 at compile time
+------------------------------+  HEAP_BASE  (= final live-data end, aligned to 8)
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

The compiler assigns this region's layout at compile time. Its static-data planner starts at `65536` and allocates space upward for:

- **Array literals** — an element block and an 8-byte `{ len: i32, data: *element }` header; the array value points to the header
- **Global struct literals** — fields at their declared layout offsets; the global variable holds the address as an `i32`
- **String literals** — an exact UTF-8 byte run and an 8-byte `{ len: i32, data: *u8 }` header; the `string` variable holds the header address

Each allocation's start address is aligned for its contents. Alignment gaps may
therefore appear between segments, but are not encoded as trailing zero bytes.
Whole-program emission discards allocations owned only by unreachable declarations
before assigning final addresses, so dead literal data does not consume static space.

Local struct literals (declared inside function bodies) are **not** placed here — they live on the shadow stack. Local array and string literals are placed here and share their static buffers across calls; writes therefore persist. A dynamic-element local array writes every element again when its declaration executes.

When a global struct field uses an expression (for example `{ x = other + 1 }`), the compiler writes a zero placeholder in static data and emits a one-time runtime store in the WebAssembly start function. Literal-valued fields remain fully compile-time encoded.

If any element of an array literal is dynamic, its entire static element block is zero-filled. Module-scope arrays fill that block from the WebAssembly start function during instantiation; local arrays fill it at the literal's evaluation point.

The planner starts at `65536` so the first WebAssembly page remains reserved for
the compiler-managed shadow stack. Static addresses baked into emitted code use
the same whole-program layout.

### Instantiation-time initialization

Deferred global scalar values, expression-valued global struct fields, and module-scope dynamic array elements run in dependency post-order from the module's WebAssembly start function. When the allocator is present, `heap_init(align8(finalDataEnd))` is the first start action. A trap in any of these initializers makes WebAssembly instantiation throw before an export can be called.

### Heap  (HEAP_BASE – heap_end)

Runtime-managed by the Maple stdlib module (`src/compiler/stdlib/memory.maple`). The allocator is a free-list allocator:

- Each chunk has an **8-byte header** `{ next: i32, size_and_flags: u32 }` where `size` is 8-aligned and bit 0 is the `ALLOC` flag.
- `malloc(n)` — scans the free list for a fit, splits oversized blocks, or carves from the wilderness; returns a pointer to the payload (header + 8).
- `free(ptr)` — marks the block free, coalesces with the next block if it is also free, and reclaims the wilderness top if the freed block is at `heap_end`.
- `realloc(old, old_size, new_size)` — `malloc` + `memory.copy` + `free`.
- `memory.grow` is called automatically when `malloc` needs more capacity.
- Merged programs place `heap_init(align8(finalDataEnd))` first in the start function, placing the heap above all static data when WebAssembly instantiation runs.
- `heap_init(data_end)` is Maple-exported from the `"memory"` module for explicit resets, but is not itself a host export. It discards the free list and resets the wilderness to `align8(data_end)`, invalidating every allocation returned before the call.
- Unwired single-module and direct-harness instances initialize lazily at `131072` on their first `malloc` call.

Programs that never call `malloc` never touch the heap region.

## Notes

- Maple reserves the first page for the shadow stack and begins merged static
  data at `65536`.
- The shadow stack grows **down** and the heap grows **up**. They could theoretically collide if a program has deeply recursive functions with many large struct locals and simultaneously performs heavy heap allocation. No overflow detection is currently implemented.
- The static data region's addresses and extent are fixed during whole-program
  emission. Its bytes remain writable; dynamic arrays and ordinary program
  writes can update their static buffers at runtime.
- The module-owned memory declaration, or the runtime memory import under
  `--import-memory`, declares `max(2, ceil(finalDataEnd / 65536) + 1)` initial
  pages, reserving enough room for static data and one heap page. `memory.grow`
  requests additional pages as needed.
