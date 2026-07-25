import { structLayout } from "../ir/layout";
import type { ASTExpression } from "../parser/ast/types/ast.type";
import type { StructMember } from "../shared/types";
import { sizeofType } from "../shared/types";

export type FnTypeKey = string;

export type FnSignature = {
  key: FnTypeKey;
  params: string[];
  results: string[];
  isVoid: boolean;
};

export type FnTableEntry = {
  slot: number;
  trampolineName: string;
  originalName: string;
  signatureKey: FnTypeKey;
  isLambda: boolean;
};

export type VariableMeta = {
  name: string;
  scope: "global" | "local" | "param";
  type: "i32" | "f32" | "bool" | `*${string}` | `${string}[]` | string;
};

export type FunctionMeta = {
  name?: string | undefined;
  params: Array<{ name: string; type: string }>;
  /** WASM-level return types for emission (`i32` covers struct pointers). */
  results: ("i32" | "f32" | "i64" | "f64")[];
  /** Maple-level return types for static checking (`Point`, `string`, `i32`, …). */
  mapleResults: string[];
  exported?: boolean;
  signature: string;
};

export type ExportFuncMeta = {
  kind: "func";
  signature: string;
};

export type ExportGlobalMeta = {
  kind: "global";
  type: string;
};

export type ExportStructMeta = {
  kind: "struct";
  meta: StructData;
};

export type ExportMeta = ExportFuncMeta | ExportGlobalMeta | ExportStructMeta;

export type ImportMeta = {
  module: string;
  name: string;
  params?: string[] | undefined;
  results?: string[] | undefined;
  info?: ExportMeta | undefined;
  resolved: boolean;
  synthesized?: boolean;
  mergeable?: boolean;
  typeIdentity?: string;
  structMeta?: StructData;
  mapleType?: string;
  mapleParams?: string[];
  mapleResults?: string[];
};
export type DeferredGlobalInit =
  | {
      kind: "memory";
      id: string;
      owner: string;
    }
  | {
      kind: "global";
      id: string;
      owner: string;
      name: string;
      type: string;
      expr: ASTExpression;
    }
  | {
      kind: "call";
      id: string;
      owner: string;
      name: string;
      args: Array<{ type: "i32"; value: number }>;
    };

export type ModuleMeta = {
  name: string;
  globals: Record<string, VariableMeta>;
  functions: Record<string, FunctionMeta>;
  imports: Record<string, ImportMeta>;
  exports: Record<string, ExportMeta>;
  structs: Record<string, StructData>;
  deferredGlobalInits: DeferredGlobalInit[];
  fnTable: Map<string, FnTableEntry>;
  fnSignatures: Map<FnTypeKey, FnSignature>;
  hasFnTypedSurface: boolean;
  needsFnrefCreation: boolean;
};

export type { StructMember };

export type StructData = {
  name: string;
  members: Record<string, StructMember>;
  size: number;
  exported?: boolean | undefined;
};

export function createStructData(
  name: string,
  members: Record<string, { name: string; type: string }>,
  exported = false,
): StructData {
  const layout = structLayout(members);
  const laidOutMembers: Record<string, StructMember> = {};
  for (const member of layout.members) {
    laidOutMembers[member.name] = {
      name: member.name,
      type: member.mapleType,
      offset: member.offset,
      size: sizeofType(member.mapleType),
    };
  }
  return { name, members: laidOutMembers, size: layout.size, exported };
}
