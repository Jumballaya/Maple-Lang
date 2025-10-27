(module

  (func $i_to_f (export "i_to_f") (param $i i32) (result f32)
    (return (f32.convert_i32_s (local.get $i)))
  )

)