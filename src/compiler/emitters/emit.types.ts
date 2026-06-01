export { sizeofType } from "../../shared/types";

export const cmpOps = new Set(["==", "!=", "<", "<=", ">", ">="]);

// removes '*' and '[]' from types
export function baseScalar(t: string): string {
  return t.replace(/\*+|(\[\])+/g, "");
}

export type WasmValueType = "i32" | "f32" | "i64" | "f64";

/** Canonical function type key, e.g. `fn(i32,i32):i32`, `fn():void`, `fn(i32):(i32,i32)`. */
export function canonicalFnType(params: string[], results: string[]): string {
  const ps = params.join(",");
  let rs: string;
  if (results.length === 0) {
    rs = "void";
  } else if (results.length === 1) {
    rs = results[0] ?? "void";
  } else {
    rs = `(${results.join(",")})`;
  }
  return `fn(${ps}):${rs}`;
}

export function isFnType(t: string): boolean {
  return t.startsWith("fn(");
}

/** Maps a canonical fn-type key to its WAT `$sig_` name, e.g. `fn(i32):i32` → `$sig_fn_i32__i32`. */
export function fnTypeToSigName(key: string): string {
  return `$sig_${key.replace(/[(),:]/g, "_")}`;
}

/** Number of WASM result values a fn-type produces: 0 for void, N for tuple, 1 otherwise. */
export function fnTypeResultCount(key: string): number {
  const parsed = parseFnType(key);
  if (!parsed) return 0;
  if (parsed.results.length === 1 && parsed.results[0] === "void") return 0;
  return parsed.results.length;
}

/** Inverse of `canonicalFnType` for tooling / error messages (handles nested `fn` in params). */
export function parseFnType(key: string): { params: string[]; results: string[] } | null {
  if (!key.startsWith("fn(")) return null;
  let depth = 0;
  for (let i = 2; i < key.length; i++) {
    const c = key[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        if (key[i + 1] !== ":") return null;
        const paramSection = key.slice(3, i);
        const afterColon = key.slice(i + 2);
        const params = paramSection === "" ? [] : splitTypesAtCommaDepth0(paramSection);
        if (afterColon.startsWith("(") && afterColon.endsWith(")")) {
          const inner = afterColon.slice(1, -1);
          const results = inner === "" ? [] : splitTypesAtCommaDepth0(inner);
          return { params, results };
        }
        return { params, results: [afterColon] };
      }
    }
  }
  return null;
}

function splitTypesAtCommaDepth0(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      const part = s.slice(start, i).trim();
      if (part) out.push(part);
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  if (last) out.push(last);
  return out;
}

export function valueTypeToWasm(t: string): WasmValueType {
  if (isFnType(t)) {
    return "i32";
  }
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
  if (b === "u8" || b === "bool") return "i32.load8_u";
  if (b === "i16") return "i32.load16_s";
  if (b === "u16") return "i32.load16_u";
  return "i32.load"; // i32/u32/ptr
}

export function wasmStoreOp(t: string): string {
  const b = baseScalar(t);
  if (b === "f64") return "f64.store";
  if (b === "f32") return "f32.store";
  if (b === "i64" || b === "u64") return "i64.store";
  if (b === "i8" || b === "u8" || b === "bool") return "i32.store8";
  if (b === "i16" || b === "u16") return "i32.store16";
  return "i32.store"; // i32/u32/ptr
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
