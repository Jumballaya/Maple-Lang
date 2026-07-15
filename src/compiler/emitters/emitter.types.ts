import type { ASTExpression } from "../../parser/ast/types/ast.type";
import type { StructMember } from "../../shared/types";

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

export type LambdaLiftedFn = {
  syntheticName: string;
  ordinal: number;
  captures: Array<{ name: string; type: string; envOffset: number }>;
  envSize: number;
  signatureKey: FnTypeKey;
};

export type VariableMeta = {
  name: string;
  scope: "global" | "local" | "memory" | "param" | "env";
  type: "i32" | "f32" | "bool" | `*${string}` | `${string}[]` | string;
  addr?: number;
  offset?: number;
  envOffset?: number;
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
export type ModuleDataMeta = { name?: string; addr: number; bytes: string };

// Initializer that runs once at startup (guarded by $__globals_inited):
// "memory" writes a struct-literal field, "global" assigns a non-const global.
export type DeferredGlobalInit =
  | {
      kind: "memory";
      baseAddr: number;
      offset: number;
      fieldType: string;
      expr: ASTExpression;
    }
  | {
      kind: "global";
      name: string;
      type: string;
      expr: ASTExpression;
    }
  | {
      kind: "call";
      name: string;
      args: Array<{ type: "i32"; value: number }>;
    };

export type FunctionContext = {
  name: string;
  params: Record<string, VariableMeta>;
  locals: Record<string, VariableMeta>;
  labels: { break?: string; loop?: string }[];
  /** Total bytes reserved on the shadow stack for this function frame (0 if none). */
  frameSize: number;
  /** Byte offset of each local struct variable from `global.get $__sp` right after prologue. */
  structFrameOffsets: Record<string, number>;
  // Lexical scope stack (innermost last) mapping source names to unique
  // WASM local names; a `let` binds as it is emitted.
  scopes: Array<Map<string, string>>;
};

export type ModuleMeta = {
  name: string;
  globals: Record<string, VariableMeta>;
  functions: Record<string, FunctionMeta>;
  imports: Record<string, ImportMeta>;
  exports: Record<string, ExportMeta>;
  structs: Record<string, StructData>;
  data: Array<ModuleDataMeta>;
  stringPool: Record<string, number>;
  dataPtr: number;
  memoryMinimumPages?: number;
  deferredGlobalInits: DeferredGlobalInit[];
  fnTable: Map<string, FnTableEntry>;
  fnSignatures: Map<FnTypeKey, FnSignature>;
  liftedLambdas: LambdaLiftedFn[];
  needsClosureRuntime: boolean;
};

export type { StructMember };

export type StructData = {
  name: string;
  members: Record<string, StructMember>;
  size: number;
  exported?: boolean | undefined;
};
