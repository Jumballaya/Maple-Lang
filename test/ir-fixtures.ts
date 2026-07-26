// biome-ignore-all lint/suspicious/noThenProperty: IR branch nodes intentionally use `then`.
import type { Expr, Func, IrGlobal, IrModule, IrType, Stmt } from "../src/ir/ir";

export function constant(type: IrType, value: number | bigint = type === "i64" ? 0n : 0): Expr {
  return { k: "const", type, value };
}

export function moduleWith(options: {
  types?: IrModule["types"];
  funcImports?: IrModule["funcImports"];
  globalImports?: IrModule["globalImports"];
  funcs?: Func[];
  globals?: IrGlobal[];
  memory?: IrModule["memory"];
  table?: IrModule["table"];
  data?: IrModule["data"];
  dataEnd?: number;
  start?: number;
  funcNames?: Array<[number, string]>;
  globalNames?: Array<[number, string]>;
  localNames?: Array<[number, Array<[number, string]>]>;
}): IrModule {
  const module: IrModule = {
    types: options.types ?? [{ params: [], results: [] }],
    funcImports: options.funcImports ?? [],
    globalImports: options.globalImports ?? [],
    funcs: options.funcs ?? [],
    globals: options.globals ?? [],
    memory: options.memory ?? { initialPages: 1, mode: "owned" },
    data: options.data ?? [],
    dataEnd: options.dataEnd ?? 65_536,
    structLayouts: new Map(),
    names: {
      funcs: new Map(options.funcNames ?? []),
      globals: new Map(options.globalNames ?? []),
      locals: new Map((options.localNames ?? []).map(([fn, names]) => [fn, new Map(names)])),
    },
  };
  if (options.table !== undefined) module.table = options.table;
  if (options.start !== undefined) module.start = options.start;
  return module;
}

export function expressionModule(expression: Expr, result: IrType): IrModule {
  return moduleWith({
    types: [{ params: [], results: [result] }],
    funcs: [{ sig: 0, locals: [], body: [{ k: "return", values: [expression] }], export: "run" }],
    funcNames: [[0, "run"]],
  });
}

export function statementModule(statement: Stmt, locals: IrType[] = []): IrModule {
  return moduleWith({
    funcs: [{ sig: 0, locals, body: [statement] }],
    funcNames: [[0, "run"]],
  });
}
