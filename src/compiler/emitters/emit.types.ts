export const cmpOps = new Set(["==", "!=", "<", "<=", ">", ">="]);

// removes '*' and '[]' from types
export function baseScalar(t: string): string {
  return t.replace(/\*+|(\[\])+/g, "");
}

export function valueTypeToWasm(t: string): "i32" | "f32" {
  const base = baseScalar(t);
  if (base === "f32") return "f32";
  return "i32"; // i8/u8/i16/u16/i32/u32/bool/ptr/arrays => i32 stack lane
}

export function sizeofType(t: string): number {
  const b = baseScalar(t);
  if (b === "i8" || b === "u8") return 1;
  if (b === "i16" || b === "u16") return 2;
  if (b === "i32" || b === "u32" || b === "f32") return 4;
  return 4;
}

export function wasmLoadOp(t: string): string {
  const b = baseScalar(t);
  if (b === "f32") return "f32.load";
  if (b === "i8") return "i32.load8_s";
  if (b === "u8") return "i32.load8_u";
  if (b === "i16") return "i32.load16_s";
  if (b === "u16") return "i32.load16_u";
  return "i32.load"; // i32/u32/ptr/bool
}

export function wasmStoreOp(t: string): string {
  const b = baseScalar(t);
  if (b === "f32") return "f32.store";
  if (b === "i8" || b === "u8") return "i32.store8";
  if (b === "i16" || b === "u16") return "i32.store16";
  return "i32.store"; // i32/u32/ptr/bool
}

export function i32CompareOp(
  op: "<" | "<=" | ">" | ">=" | "==" | "!=",
  signed: boolean
): string {
  switch (op) {
    case "<": {
      return signed ? "i32.lt_s" : "i32.lt_u";
    }
    case "<=": {
      return signed ? "i32.le_s" : "i32.le_u";
    }
    case ">": {
      return signed ? "i32.gt_s" : "i32.gt_u";
    }
    case ">=": {
      return signed ? "i32.ge_s" : "i32.ge_u";
    }
    case "==": {
      return "i32.eq";
    }
    case "!=": {
      return "i32.ne";
    }
  }
}
