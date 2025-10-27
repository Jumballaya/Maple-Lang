(module

  (type $iii_i_type (func (param i32 i32 i32) (result i32)))
  (type $i_i_type (func (param i32) (result i32)))
  (type $i_v_type (func (param i32)))

  (import "runtime" "memory" (memory 2))
  (import "memory" "malloc" (func $malloc (type $i_i_type)))
  (import "memory" "free" (func $free (type $i_v_type)))
  (import "memory" "realloc" (func $realloc (type $iii_i_type)))


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