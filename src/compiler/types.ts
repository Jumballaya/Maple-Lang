export { sizeofType } from "../shared/types";

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

const UNSIGNED_INTS = new Set(["u8", "u16", "u32", "u64"]);

export function isUnsignedMapleInteger(t: string): boolean {
  return UNSIGNED_INTS.has(baseScalar(t));
}

export function extractFunctionSignature(
  signature: string,
): [WasmValueType[] | "void", WasmValueType[] | "void", string] {
  const decode = (section: string): WasmValueType[] | "void" => {
    if (section === "" || section === "v") return "void";
    const values: WasmValueType[] = [];
    for (const character of section) {
      if (character === "i") values.push("i32");
      if (character === "I") values.push("i64");
      if (character === "f") values.push("f32");
      if (character === "F") values.push("f64");
    }
    return values;
  };
  const [params = "", results = ""] = signature.split("_");
  return [decode(params), decode(results), `$${signature}_type`];
}
