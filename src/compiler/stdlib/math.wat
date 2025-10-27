(module

  (func $i_to_f (export "i_to_f") (param $i i32) (result f32)
    (return (f32.convert_i32_s (local.get $i)))
  )

  (func $min_i32 (export "min_i32") (param $a i32) (param $b i32) (result i32)
    (if
      (i32.lt_s (local.get $a) (local.get $b))
      (then (return (local.get $a)))
    )
    (return (local.get $b))
  )

  (func $min_f32 (export "min_f32") (param $a f32) (param $b f32) (result f32)
    (if
      (f32.lt (local.get $a) (local.get $b))
      (then (return (local.get $a)))
    )
    (return (local.get $b))
  )


  (func $max_i32 (export "max_i32") (param $a i32) (param $b i32) (result i32)
    (if
      (i32.lt_s (local.get $a) (local.get $b))
      (then (return (local.get $b)))
    )
    (return (local.get $a))
  )

  (func $max_f32 (export "max_f32") (param $a f32) (param $b f32) (result f32)
    (if
      (f32.lt (local.get $a) (local.get $b))
      (then (return (local.get $b)))
    )
    (return (local.get $a))
  )
)