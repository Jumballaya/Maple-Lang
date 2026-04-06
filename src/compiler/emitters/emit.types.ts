export { sizeofType } from "../../shared/types";

export const cmpOps = new Set(["==", "!=", "<", "<=", ">", ">="]);

// removes '*' and '[]' from types
export function baseScalar(t: string): string {
  return t.replace(/\*+|(\[\])+/g, "");
}

export type WasmValueType = "i32" | "f32" | "i64" | "f64";

export function valueTypeToWasm(t: string): WasmValueType {
  if (t.startsWith("*") || t.endsWith("[]")) {
    return "i32";
  }
  const base = baseScalar(t);
  if (base === "f64") return "f64";
  if (base === "f32") return "f32";
  if (base === "i64" || base === "u64") return "i64";
  return "i32"; // i8/u8/i16/u16/i32/u32/bool/ptr => i32 stack lane
}

export function wasmLoadOp(t: string): string {
  const b = baseScalar(t);
  if (b === "f64") return "f64.load";
  if (b === "f32") return "f32.load";
  if (b === "i64" || b === "u64") return "i64.load";
  if (b === "i8") return "i32.load8_s";
  if (b === "u8") return "i32.load8_u";
  if (b === "i16") return "i32.load16_s";
  if (b === "u16") return "i32.load16_u";
  return "i32.load"; // i32/u32/ptr/bool
}

export function wasmStoreOp(t: string): string {
  const b = baseScalar(t);
  if (b === "f64") return "f64.store";
  if (b === "f32") return "f32.store";
  if (b === "i64" || b === "u64") return "i64.store";
  if (b === "i8" || b === "u8") return "i32.store8";
  if (b === "i16" || b === "u16") return "i32.store16";
  return "i32.store"; // i32/u32/ptr/bool
}

export function i32CompareOp(op: "<" | "<=" | ">" | ">=" | "==" | "!=", signed: boolean): string {
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

export function i64CompareOp(op: "<" | "<=" | ">" | ">=" | "==" | "!=", signed: boolean): string {
  switch (op) {
    case "<": {
      return signed ? "i64.lt_s" : "i64.lt_u";
    }
    case "<=": {
      return signed ? "i64.le_s" : "i64.le_u";
    }
    case ">": {
      return signed ? "i64.gt_s" : "i64.gt_u";
    }
    case ">=": {
      return signed ? "i64.ge_s" : "i64.ge_u";
    }
    case "==": {
      return "i64.eq";
    }
    case "!=": {
      return "i64.ne";
    }
  }
}

export function f64CompareOp(op: "<" | "<=" | ">" | ">=" | "==" | "!="): string {
  switch (op) {
    case "<":
      return "f64.lt";
    case "<=":
      return "f64.le";
    case ">":
      return "f64.gt";
    case ">=":
      return "f64.ge";
    case "==":
      return "f64.eq";
    case "!=":
      return "f64.ne";
  }
}

const UNSIGNED_INTS = new Set(["u8", "u16", "u32", "u64"]);

export function isUnsignedMapleInteger(t: string): boolean {
  return UNSIGNED_INTS.has(baseScalar(t));
}

/** Single-letter WASM lane codes used in import/function signature strings. */
export function wasmLaneToSignatureChar(w: WasmValueType | "void"): string {
  if (w === "void") return "v";
  if (w === "i32") return "i";
  if (w === "i64") return "I";
  if (w === "f32") return "f";
  return "F";
}
