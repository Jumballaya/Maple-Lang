export type StructMember = {
  name: string;
  type: string;
  offset: number;
  size: number;
};

function stripDecorators(t: string): string {
  return t.replace(/\*+|(\[\])+/g, "");
}

export function sizeofType(t: string): number {
  const b = stripDecorators(t);
  if (b === "i8" || b === "u8" || b === "bool") return 1;
  if (b === "i16" || b === "u16") return 2;
  if (b === "i32" || b === "u32" || b === "f32") return 4;
  if (b === "i64" || b === "u64" || b === "f64") return 8;
  return 4;
}

// Scalars align to their size; anything address-backed aligns to 4.
export function alignofType(t: string): number {
  if (t.endsWith("[]") || t.startsWith("*")) return 4;
  return sizeofType(t);
}

export function alignTo(value: number, alignment: number): number {
  const rem = value % alignment;
  return rem === 0 ? value : value + alignment - rem;
}
