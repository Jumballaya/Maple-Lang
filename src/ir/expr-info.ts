import type { BinOp, Expr, FuncId, IrModule, IrType, Sig } from "./ir";

const INTEGER_TYPES = new Set<IrType>(["i32", "i64"]);

export function binOpcode(op: BinOp, type: IrType, signed: boolean): string {
  switch (op) {
    case "div":
    case "rem":
      return INTEGER_TYPES.has(type) ? `${type}.${op}_${signed ? "s" : "u"}` : `${type}.${op}`;
    case "shr":
      return `${type}.shr_${signed ? "s" : "u"}`;
    case "lt":
    case "le":
    case "gt":
    case "ge":
      return INTEGER_TYPES.has(type) ? `${type}.${op}_${signed ? "s" : "u"}` : `${type}.${op}`;
    case "add":
    case "sub":
    case "mul":
    case "and":
    case "or":
    case "xor":
    case "shl":
    case "eq":
    case "ne":
    case "copysign":
      return `${type}.${op}`;
    default:
      return unknownBinop(op);
  }
}

export function loadOpcode(
  type: IrType,
  width: 8 | 16 | undefined,
  signed: boolean | undefined,
): string {
  return width === undefined ? `${type}.load` : `${type}.load${width}_${signed ? "s" : "u"}`;
}

export function storeOpcode(type: IrType, width: 8 | 16 | undefined): string {
  return width === undefined ? `${type}.store` : `${type}.store${width}`;
}

export function exprType(
  module: IrModule,
  localTypes: readonly IrType[],
  expression: Expr,
): IrType {
  switch (expression.k) {
    case "const":
    case "binop":
    case "unop":
    case "load":
    case "if_val":
      if (
        (expression.k === "binop" &&
          ["eq", "ne", "lt", "le", "gt", "ge"].includes(expression.op)) ||
        (expression.k === "unop" && expression.op === "eqz")
      ) {
        return "i32";
      }
      return expression.type;
    case "local.get":
      return localTypes[expression.id]!;
    case "global.get":
      return globalType(module, expression.id);
    case "convert": {
      const result = expression.op.slice(0, 3);
      if (result === "i32" || result === "i64" || result === "f32" || result === "f64") {
        return result;
      }
      throw new Error(`unknown IR conversion: ${expression.op}`);
    }
    case "call":
      return funcSig(module, expression.fn).results[0]!;
    case "call_indirect":
      return sig(module, expression.sig).results[0]!;
    case "seq":
      return exprType(module, localTypes, expression.value);
    case "memory.size":
    case "memory.grow":
      return "i32";
    default:
      return unknownExpression(expression);
  }
}

function sig(module: IrModule, id: number): Sig {
  const signature = module.types[id];
  if (!signature) throw new Error(`unknown IR signature id: ${id}`);
  return signature;
}

function funcSig(module: IrModule, id: FuncId): Sig {
  const sigId =
    id < module.funcImports.length
      ? module.funcImports[id]?.sig
      : module.funcs[id - module.funcImports.length]?.sig;
  if (sigId === undefined) throw new Error(`unknown IR function id: ${id}`);
  return sig(module, sigId);
}

function globalType(module: IrModule, id: number): IrType {
  if (id < module.globalImports.length) {
    const imported = module.globalImports[id];
    if (imported) return imported.type;
  }
  const global = module.globals[id - module.globalImports.length];
  if (!global) throw new Error(`unknown IR global id: ${id}`);
  return global.type;
}

function unknownExpression(expression: never): never {
  throw new Error(`unknown IR expression kind: ${(expression as { k?: unknown }).k}`);
}

function unknownBinop(op: never): never {
  throw new Error(`unknown IR binop: ${op}`);
}
