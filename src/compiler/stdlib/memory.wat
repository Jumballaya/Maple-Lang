(module
  (import "runtime" "memory" (memory 2)) ;; 2 pages = 128KiB to start
  (import "console" "print_string" (func $print_string (param i32)))

  ;; Heap Setup
  ;;
  ;;    HEAP       -- starts at 0, aligned to 8-bytes
  ;;    Free List  -- singly linked list of free chunks
  ;;
  ;;    HEAP_BASE --> start of the heap, after all data segments
  ;;    heap_end  --> one-past last user byte, where the next malloc will start
  ;;    free_head --> head of the free list (0 = no nodes)
  ;;
  (global $HEAP_BASE (mut i32) (i32.const 0))
  (global $heap_end (mut i32) (i32.const 0))
  (global $free_head (mut i32) (i32.const 0))
  ;;
  ;;
  ;;  Each chunk has an 8-byte header
  ;;    { next: i32, size_and_flags: u32 }
  ;;
  ;;  size is 8-aligned; bit0 is ALLOC flag
  ;;
  ;;
  ;;
  ;;  Helper Functions
  ;; ----------------------------
  (func $align8 (param $x i32) (result i32)
    (i32.and
      (i32.add
        (local.get $x)
        (i32.const 7)
      )
      (i32.const -8)
    )
  )
  (func $hdr_next (param $hdr i32) (result i32) ;; [hdr+0]
    (i32.load (local.get $hdr))
  )
  (func $hdr_set_next (param $hdr i32) (param $n i32) ;; [hdr+0] = n
    (i32.store (local.get $hdr) (local.get $n))
  )
  (func $hdr_raw (param $hdr i32) (result i32)  ;; [hdr+4] = size|flags
    (i32.load
      (i32.add
        (local.get $hdr)
        (i32.const 4)
      )
    )
  )
  (func $hdr_size (param $hdr i32) (result i32) ;; mask flags
    (i32.and
      (call $hdr_raw (local.get $hdr))
      (i32.const -8)
    )
  )
  (func $hdr_is_alloc (param $hdr i32) (result i32)
    (i32.ne
      (i32.and
        (call $hdr_raw (local.get $hdr))
        (i32.const 1)
      )
      (i32.const 0)
    )
  )
  (func $hdr_write (param $hdr i32) (param $size i32) (param $alloc i32)
    ;; write size (aligned) + alloc flag into [hdr+4]
    (i32.store
      (i32.add (local.get $hdr) (i32.const 4))
      (i32.or
        (i32.and (local.get $size) (i32.const -8))
        (i32.and (local.get $alloc) (i32.const 1))
      )
    )
  )
  (func $ensure_capacity (param $need_end i32) (result i32)
    (local $cur_bytes i32)
    (local.set $cur_bytes (i32.shl (memory.size) (i32.const 16))) ;; pages * 65536

    ;; if (need_end <= cur_bytes) return 1
    (if (result i32)
      (i32.le_u (local.get $need_end) (local.get $cur_bytes))
      (then (i32.const 1))
      (else
        ;; pages_needed = ceil((need_end - cur_bytes) / 65536)
        (i32.ne        ;; memory.grow != -1
          (memory.grow
            (i32.shr_u
              (i32.add
                (i32.sub (local.get $need_end) (local.get $cur_bytes))
                (i32.const 65535)
              )
              (i32.const 16)
            )
          )
          (i32.const -1)
        )
      )
    )
  )
  (func $split_if_big (param $hdr i32) (param $want i32) (result i32)
    (local $sz i32) (local $tail_hdr i32) (local $tail_sz i32)

    ;; sz = hdr_size(hdr)
    (local.set $sz (call $hdr_size (local.get $hdr)))

    ;; if (sz - want) >= 16  (i.e., room for header + minimal payload), split
    (if
      (i32.ge_u
        (i32.sub (local.get $sz) (local.get $want))
        (i32.const 16)
      )
      (then
        ;; carve tail
        (local.set $tail_hdr (i32.add (local.get $hdr) (local.get $want)))
        (local.set $tail_sz  (i32.sub (local.get $sz)  (local.get $want)))

        ;; write new free tail
        (call $hdr_write (local.get $tail_hdr) (local.get $tail_sz) (i32.const 0))

        ;; shrink current (still free for the moment)
        (call $hdr_write (local.get $hdr) (local.get $want) (i32.const 0))

        ;; add tail to free list
        (call $freelist_push (local.get $tail_hdr))

        (return (i32.const 1))
      )
    )

    (i32.const 0)
  )
  ;;
  ;;
  ;;
  ;;    Initialize Heap
  ;;      Point the heap to a specified location (after data)
  ;;
  (func $heap_init (param $data_end i32)
    (global.set $HEAP_BASE (call $align8 (local.get $data_end)))
    (global.set $heap_end (global.get $HEAP_BASE))
    (global.set $free_head (i32.const 0))
  )
  ;;
  ;;
  ;;  Free List
  ;;
  ;;
  ;;
  ;;
  ;;
  ;;
  ;;
  ;;
  ;; Push header entry on to the free list
  (func $freelist_push (param $hdr i32)
    (call $hdr_set_next (local.get $hdr) (global.get $free_head))
    (global.set $free_head (local.get $hdr))
  )
  ;;
  ;;
  ;;  Removes an entry from the free list based on the header
  ;;  removing arbitrary nodes is O(n)
  ;;
  (func $freelist_unlink (param $hdr i32)
    (local $prev i32)
    (local $cur i32)
    (local.set $prev (i32.const 0))
    (local.set $cur (global.get $free_head))

    (block $done
      (loop $scan
        (br_if $done (i32.eqz (local.get $cur)))  ;; reached end
        (if
          (i32.eq (local.get $cur) (local.get $hdr))
          (then
            (if
              ;; unlink
              (i32.eqz (local.get $prev))
              (then
                ;; removing head
                (global.set $free_head (call $hdr_next (local.get $hdr)))
              )
              (else
                (call $hdr_set_next
                    (local.get $prev)
                    (call $hdr_next (local.get $hdr))
                )
              )
            )
            (br $done)
          )
        )
        (local.set $prev (local.get $cur))
        (local.set $cur (call $hdr_next (local.get $cur)))
        (br $scan)
      )
    )
  )
  ;;
  ;;
  ;;  Malloc
  ;;
  (func $malloc (export "malloc") (param $n_bytes i32) (result i32)
    (local $n i32)
    (local $needed i32)
    (local $prev i32)
    (local $cur i32)
    (local $sz i32)
    (local $hdr i32)
    (local $need_end i32)

    ;; n = max(1, n_bytes)
    (if
      (i32.lt_u (local.get $n_bytes) (i32.const 1))
      (then (local.set $n (i32.const 1)))
      (else (local.set $n (local.get $n_bytes)))
    )

    ;; needed = align8(n) + 8 (header)
    (local.set $needed
      (i32.add
        (call $align8 (local.get $n))
        (i32.const 8)
      )
    )

    ;; 1. scan free list
    (local.set $prev (i32.const 0))
    (local.set $cur (global.get $free_head))
    (block $not_found
      (loop $scan
        (br_if $not_found (i32.eqz (local.get $cur)))
        (local.set $sz (call $hdr_size (local.get $cur)))
        (if
          (i32.ge_u (local.get $sz) (local.get $needed))
          (then
            ;; try to split, ignore the bool return
            (drop (call $split_if_big (local.get $cur) (local.get $needed)))
            ;; unlink cur (the used portion after the optional split)
            (call $freelist_unlink (local.get $cur))
            ;; mark allocated
            (call $hdr_write (local.get $cur) (local.get $needed) (i32.const 1))
            ;; return payload
            (return (i32.add (local.get $cur) (i32.const 8)))
          )
        )
        (local.set $prev (local.get $cur))
        (local.set $cur (call $hdr_next (local.get $cur)))
        (br $scan)
      )
    )

    ;; 2. carve from wilderness
    (local.set $hdr (global.get $heap_end))

    ;; ensure capacity up to heap_end + needed
    (local.set $need_end (i32.add (global.get $heap_end) (local.get $needed)))
    (if
      (i32.eqz (call $ensure_capacity (local.get $need_end)))
      (then (return (i32.const 0)))
    )

    ;; advance heap_end
    (global.set $heap_end (local.get $need_end))

    ;; write header and return payload
    (call $hdr_write (local.get $hdr) (local.get $needed) (i32.const 1))
    
    ;; return the pointer to the malloc'd memory offset by the header size (8)
    (i32.add (local.get $hdr) (i32.const 8))
  )
  ;;
  ;;
  ;;  Free
  ;;
  (func $free (export "free") (param $ptr i32)
    (local $hdr i32)
    (local $size i32)
    (local $next i32)

    ;; early return on null ptr
    (if
      (i32.eqz (local.get $ptr))
      (then return)
    )

    ;; hdr = payload - 8
    (local.set $hdr (i32.sub (local.get $ptr) (i32.const 8)))

    ;; sanity: was it actually allocated?
    ;; we ignore double frees at the moment
    (if
      (i32.eqz (call $hdr_is_alloc (local.get $hdr)))
      (then return)
    )

    ;; size = hdr_size(hdr)
    (local.set $size (call $hdr_size (local.get $hdr)))
    ;; try to coalesce with next
    (local.set $next (i32.add (local.get $hdr) (local.get $size)))
  
    (if
      ;; next exists; if free then merge
      (i32.lt_u (local.get $next) (global.get $heap_end))
      (then
        (if
          (i32.eqz (call $hdr_is_alloc (local.get $next)))
          (then
            ;; remove 'next from free list, absorb its size
            (call $freelist_unlink (local.get $next))
            (local.set $size
              (i32.add (local.get $size) (call $hdr_size (local.get $next)))
            )
          )
        )
      )
    )

    ;; mark this block free with new size, push to free list
    (call $hdr_write (local.get $hdr) (local.get $size) (i32.const 0))
    (call $freelist_push (local.get $hdr))
    ;; if this free block touches wilderness, reclaim top
    (if
      (i32.eq
        (i32.add (local.get $hdr) (local.get $size))
        (global.get $heap_end)
      )
      (then
        ;; pop from free list, then move heap_end down
        (call $freelist_unlink (local.get $hdr))
        (global.set $heap_end (local.get $hdr))
      )
    )
  )
  ;;
  ;;
  ;;
  ;;  Realloc
  ;;
  (func $realloc (export "realloc") (param $old i32) (param $old_size i32) (param $new_size i32) (result i32)
    (local $np i32)
    (local.set $np (call $malloc (local.get $new_size)))
    (if (i32.eqz (local.get $np)) (then (return (i32.const 0))))
    (if (i32.eqz (local.get $old))
      (then (return (local.get $np)))
    )
    (memory.copy (local.get $np) (local.get $old)
                (select (local.get $old_size) (local.get $new_size)
                        (i32.lt_u (local.get $old_size) (local.get $new_size))))
    (call $free (local.get $old))
    (local.get $np)
  )

  ;;
  ;;  fn min(a: i32, b: i32): i32 {
  ;;    if (a < b) {
  ;;      return a;
  ;;    }
  ;;    return b;
  ;;  }
  ;;
  (func $min (param $a i32) (param $b i32) (result i32)
    (if
      (i32.lt_s (local.get $a) (local.get $b))
      (then (return (local.get $a)))
    )
    (return (local.get $b))
  )

  ;;
  ;;  Copies one string to another
  ;;
  (func $string_copy (export "string_copy") (param $from_ptr i32) (param $to_ptr i32)
    (memory.copy
      (i32.load offset=4 (local.get $to_ptr))     ;; from->data
      (i32.load offset=4 (local.get $from_ptr))   ;; to->data
      (call $min                                  ;; min(from->len, to->len)
        (i32.load (local.get $to_ptr))
        (i32.load (local.get $from_ptr))
      )
    )
  )
)