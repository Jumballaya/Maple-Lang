export type IntrinsicValueType = "i32" | "f32" | "f64";

export type IntrinsicDefinition = {
  params: readonly IntrinsicValueType[];
  result: IntrinsicValueType | "void";
  instruction: string;
};

export const INTRINSICS = {
  __load_i32: { params: ["i32"], result: "i32", instruction: "i32.load" },
  __store_i32: { params: ["i32", "i32"], result: "void", instruction: "i32.store" },
  __memory_size: { params: [], result: "i32", instruction: "memory.size" },
  __memory_grow: { params: ["i32"], result: "i32", instruction: "memory.grow" },
  __memory_copy: {
    params: ["i32", "i32", "i32"],
    result: "void",
    instruction: "memory.copy",
  },
  __trap: { params: [], result: "void", instruction: "unreachable" },
  __sqrt_f32: { params: ["f32"], result: "f32", instruction: "f32.sqrt" },
  __abs_f32: { params: ["f32"], result: "f32", instruction: "f32.abs" },
  __floor_f32: { params: ["f32"], result: "f32", instruction: "f32.floor" },
  __ceil_f32: { params: ["f32"], result: "f32", instruction: "f32.ceil" },
  __nearest_f32: { params: ["f32"], result: "f32", instruction: "f32.nearest" },
  __trunc_f32: { params: ["f32"], result: "f32", instruction: "f32.trunc" },
  __copysign_f32: {
    params: ["f32", "f32"],
    result: "f32",
    instruction: "f32.copysign",
  },
  __sqrt_f64: { params: ["f64"], result: "f64", instruction: "f64.sqrt" },
  __abs_f64: { params: ["f64"], result: "f64", instruction: "f64.abs" },
  __floor_f64: { params: ["f64"], result: "f64", instruction: "f64.floor" },
  __ceil_f64: { params: ["f64"], result: "f64", instruction: "f64.ceil" },
  __nearest_f64: { params: ["f64"], result: "f64", instruction: "f64.nearest" },
  __trunc_f64: { params: ["f64"], result: "f64", instruction: "f64.trunc" },
  __copysign_f64: {
    params: ["f64", "f64"],
    result: "f64",
    instruction: "f64.copysign",
  },
} as const satisfies Record<string, IntrinsicDefinition>;

export function getIntrinsic(name: string): IntrinsicDefinition | undefined {
  if (!Object.hasOwn(INTRINSICS, name)) return undefined;
  return INTRINSICS[name as keyof typeof INTRINSICS];
}
