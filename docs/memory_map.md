```lua
+------------------------------+  0x0000_0000
|  Reserved / Null page        |  (optional guard, unmapped in mental model)
+------------------------------+
|  Data section (RO “consts”)  |  literals, static tables, vtables later
+------------------------------+
|  String pool (bytes only)    |  deduped literal bytes (zero-terminated if you like)
+------------------------------+
|  Static structs for literals |  optional: {len,ptr} records for strings, etc.
+------------------------------+
|  ... padding/alignment ...   |
+------------------------------+  HEAP_BASE  → aligned to 8/16
|            HEAP              |  malloc/free arena
|   (free/used blocks w/ hdr)  |  grows upward
|           (wilderness →)     |
+------------------------------+  heap_end (logical top)
|          Unused gap          |
+------------------------------+  STACK_TOP  → optional linear-memory stack
|            STACK             |  grows downward (if you implement &locals)
+------------------------------+
|     Reserved future space    |
+------------------------------+  memory.size * 64KiB
```
