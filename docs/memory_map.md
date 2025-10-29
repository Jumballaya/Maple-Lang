```lua
+------------------------------+  0x0000_0000
|  Reserved / Null page        |  (unmapped)
+------------------------------+
|  Data section (RO “consts”)  |  literals, static tables
+------------------------------+
|  String pool (bytes only)    |  deduped literal bytes
+------------------------------+
|  Static structs for literals |  {len,ptr} records for strings, etc.
+------------------------------+
|  ... padding/alignment ...   |
+------------------------------+  HEAP_BASE  → aligned to 8/16
|            HEAP              |  malloc/free arena
|   (free/used blocks w/ hdr)  |  grows upward
|           (wilderness →)     |
+------------------------------+  heap_end (logical top)
|          Unused gap          |
+------------------------------+  STACK_TOP  → optional linear-memory stack
|            STACK             |  grows downward
+------------------------------+
|     Reserved future space    |
+------------------------------+  memory.size * 64KiB
```
