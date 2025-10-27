export type VariableMeta = {
  name: string;
  scope: "global" | "local" | "memory" | "param";
  type: "i32" | "f32" | "bool" | `*${string}` | `${string}[]` | string;
  addr?: number;
  offset?: number;
};

export type FunctionMeta = {
  name?: string | undefined;
  params: Array<{ name: string; type: string }>;
  result: "i32" | "f32" | "void";
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
  result?: string | undefined;
  info?: ExportMeta | undefined;
  resolved: boolean;
};
export type ModuleDataMeta = { name?: string; addr: number; bytes: string };

export type FunctionContext = {
  name: string;
  params: Record<string, VariableMeta>;
  locals: Record<string, VariableMeta>;
  labels: { break?: string; loop?: string }[];
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
};

export type StructMember = {
  name: string;
  type: string;
  offset: number;
  size: number;
};

export type StructData = {
  name: string;
  members: Record<string, StructMember>;
  size: number;
  exported?: boolean | undefined;
};
