export type IrType = "i32" | "i64" | "f32" | "f64";

export type FuncId = number;
export type GlobalId = number;
export type LocalId = number;
export type SigId = number;
export type LabelId = number;

export type BinOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "rem"
  | "and"
  | "or"
  | "xor"
  | "shl"
  | "shr"
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "copysign";

export type UnOp = "eqz" | "neg" | "abs" | "sqrt" | "floor" | "ceil" | "trunc" | "nearest";

export type ConvOp =
  | "i32.wrap_i64"
  | "i64.extend_i32_s"
  | "i64.extend_i32_u"
  | "i32.trunc_f32_s"
  | "i32.trunc_f32_u"
  | "i32.trunc_f64_s"
  | "i32.trunc_f64_u"
  | "i64.trunc_f32_s"
  | "i64.trunc_f32_u"
  | "i64.trunc_f64_s"
  | "i64.trunc_f64_u"
  | "f32.convert_i32_s"
  | "f32.convert_i32_u"
  | "f32.convert_i64_s"
  | "f32.convert_i64_u"
  | "f64.convert_i32_s"
  | "f64.convert_i32_u"
  | "f64.convert_i64_s"
  | "f64.convert_i64_u"
  | "f32.demote_f64"
  | "f64.promote_f32"
  | "i32.extend8_s"
  | "i32.extend16_s"
  | "i64.extend8_s"
  | "i64.extend16_s"
  | "i64.extend32_s";

export type ConstExpr = {
  k: "const";
  type: IrType;
  value: number | bigint;
};

export type Expr =
  | ConstExpr
  | { k: "local.get"; id: LocalId }
  | { k: "global.get"; id: GlobalId }
  | { k: "binop"; op: BinOp; type: IrType; signed: boolean; l: Expr; r: Expr }
  | { k: "unop"; op: UnOp; type: IrType; e: Expr }
  | { k: "convert"; op: ConvOp; e: Expr }
  | {
      k: "load";
      type: IrType;
      width?: 8 | 16;
      signed?: boolean;
      addr: Expr;
      offset: number;
    }
  | { k: "call"; fn: FuncId; args: Expr[] }
  | { k: "call_indirect"; sig: SigId; index: Expr; args: Expr[] }
  | { k: "if_val"; cond: Expr; then: Expr; else: Expr; type: IrType }
  | { k: "seq"; stmts: Stmt[]; value: Expr }
  | { k: "memory.size" }
  | { k: "memory.grow"; pages: Expr };

export type MultiCallCallee =
  | { kind: "func"; fn: FuncId }
  | { kind: "indirect"; sig: SigId; index: Expr };

export type Stmt =
  | { k: "local.set"; id: LocalId; e: Expr }
  | { k: "global.set"; id: GlobalId; e: Expr }
  | {
      k: "store";
      type: IrType;
      width?: 8 | 16;
      addr: Expr;
      value: Expr;
      offset: number;
    }
  | { k: "call"; fn: FuncId; args: Expr[] }
  | { k: "drop"; e: Expr }
  | { k: "multi_call"; callee: MultiCallCallee; args: Expr[]; targets: LocalId[] | null }
  | { k: "call_indirect"; sig: SigId; index: Expr; args: Expr[] }
  | { k: "if"; cond: Expr; then: Stmt[]; else?: Stmt[] }
  | { k: "block"; label: LabelId; body: Stmt[] }
  | { k: "loop"; label: LabelId; body: Stmt[] }
  | { k: "br"; label: LabelId }
  | { k: "br_if"; label: LabelId; cond: Expr }
  | { k: "return"; values: Expr[] }
  | { k: "unreachable" }
  | { k: "memory.copy"; dest: Expr; src: Expr; len: Expr };

export type Sig = {
  params: IrType[];
  results: IrType[];
};

export type FuncImport = {
  module: string;
  name: string;
  sig: SigId;
};

export type GlobalImport = {
  module: string;
  name: string;
  type: IrType;
};

export type Func = {
  sig: SigId;
  locals: IrType[];
  body: Stmt[];
  export?: string;
};

export type IrGlobal = {
  type: IrType;
  mutable: boolean;
  init: ConstExpr;
  export?: string;
};

export type StructLayoutMember = {
  name: string;
  offset: number;
  mapleType: string;
  lane: IrType;
  width?: 8 | 16;
  memberIdentity?: string;
};

export type StructLayout = {
  size: number;
  align: number;
  members: StructLayoutMember[];
};

export type IrModule = {
  types: Sig[];
  funcImports: FuncImport[];
  globalImports: GlobalImport[];
  funcs: Func[];
  globals: IrGlobal[];
  memory: { initialPages: number; mode: "owned" | "imported" };
  table?: { entries: FuncId[] };
  data: Array<{ addr: number; bytes: Uint8Array }>;
  dataEnd: number;
  structLayouts: Map<string, StructLayout>;
  start?: FuncId;
  names: {
    funcs: Map<FuncId, string>;
    globals: Map<GlobalId, string>;
    locals: Map<FuncId, Map<LocalId, string>>;
  };
};
