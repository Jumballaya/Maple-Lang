import { isFnType, valueTypeToWasm } from "../compiler/types";
import type { StructMember } from "../shared/types";
import { alignofType, alignTo, sizeofType } from "../shared/types";
import type { StructLayout, StructLayoutMember } from "./ir";

const SCALAR_TYPES = new Set([
  "i8",
  "u8",
  "i16",
  "u16",
  "i32",
  "u32",
  "i64",
  "u64",
  "f32",
  "f64",
  "bool",
]);

function widthOf(mapleType: string): 8 | 16 | undefined {
  if (mapleType === "i8" || mapleType === "u8" || mapleType === "bool") return 8;
  if (mapleType === "i16" || mapleType === "u16") return 16;
  return undefined;
}

function memberIdentity(mapleType: string): string | undefined {
  if (mapleType === "string") return "string";
  if (
    SCALAR_TYPES.has(mapleType) ||
    mapleType.endsWith("[]") ||
    mapleType.startsWith("*") ||
    isFnType(mapleType)
  ) {
    return undefined;
  }
  return mapleType;
}

export function structLayout(
  members: Record<string, Pick<StructMember, "name" | "type">>,
): StructLayout {
  const result: StructLayoutMember[] = [];
  let size = 0;
  let align = 1;

  for (const member of Object.values(members)) {
    const memberAlign = alignofType(member.type);
    size = alignTo(size, memberAlign);
    align = Math.max(align, memberAlign);
    const layoutMember: StructLayoutMember = {
      name: member.name,
      offset: size,
      mapleType: member.type,
      lane: valueTypeToWasm(member.type),
    };
    const width = widthOf(member.type);
    const identity = memberIdentity(member.type);
    if (width !== undefined) layoutMember.width = width;
    if (identity !== undefined) layoutMember.memberIdentity = identity;
    result.push(layoutMember);
    size += sizeofType(member.type);
  }

  return { size: alignTo(size, align), align, members: result };
}
