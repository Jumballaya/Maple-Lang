// biome-ignore-all lint/suspicious/noThenProperty: IR branch nodes intentionally use `then`.
import assert from "node:assert/strict";
import { encodeWasm } from "../src/ir/encode-wasm";
import type {
  BinOp,
  ConvOp,
  Expr,
  Func,
  IrGlobal,
  IrModule,
  IrType,
  Stmt,
  UnOp,
} from "../src/ir/ir";
import { validateModule } from "../src/ir/validate";

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

function defaultImports(module: IrModule): WebAssembly.Imports {
  if (module.memory.mode === "owned") return {};
  return {
    runtime: {
      memory: new WebAssembly.Memory({ initial: module.memory.initialPages }),
    },
  };
}

export function mergeImports(
  module: IrModule,
  imports: WebAssembly.Imports = {},
): WebAssembly.Imports {
  const automatic = defaultImports(module);
  const merged: WebAssembly.Imports = {};
  for (const namespace of new Set([...Object.keys(automatic), ...Object.keys(imports)])) {
    merged[namespace] = {
      ...(automatic[namespace] ?? {}),
      ...(imports[namespace] ?? {}),
    };
  }
  return merged;
}

export function encoded(module: IrModule): Uint8Array {
  assert.deepEqual(validateModule(module), []);
  return encodeWasm(module);
}

export function runEncoded(
  module: IrModule,
  entry: string,
  args: Array<number | bigint> = [],
  imports?: WebAssembly.Imports,
): unknown {
  const compiled = new WebAssembly.Module(encoded(module) as Uint8Array<ArrayBuffer>);
  const instance = new WebAssembly.Instance(compiled, mergeImports(module, imports));
  const fn = instance.exports[entry];
  assert.equal(typeof fn, "function");
  return (fn as (...values: Array<number | bigint>) => unknown)(...args);
}

export type IrExecutionCase = {
  name: string;
  module: IrModule;
  entry: string;
  args?: Array<number | bigint>;
  expected: unknown;
};

const INTEGER_LANES: readonly IrType[] = ["i32", "i64"];
const FLOAT_LANES: readonly IrType[] = ["f32", "f64"];
const ALL_LANES: readonly IrType[] = [...INTEGER_LANES, ...FLOAT_LANES];

function laneValue(type: IrType, value: number): number | bigint {
  return type === "i64" ? BigInt(value) : value;
}

function binopLanes(op: BinOp): readonly IrType[] {
  switch (op) {
    case "rem":
    case "and":
    case "or":
    case "xor":
    case "shl":
    case "shr":
      return INTEGER_LANES;
    case "copysign":
      return FLOAT_LANES;
    default:
      return ALL_LANES;
  }
}

function binopOperands(
  op: BinOp,
  type: IrType,
  signed: boolean,
): { left: number | bigint; right: number | bigint; expected: unknown } {
  const i64 = type === "i64";
  const integer = type === "i32" || i64;
  switch (op) {
    case "add":
      return { left: laneValue(type, 7), right: laneValue(type, 2), expected: laneValue(type, 9) };
    case "sub":
      return { left: laneValue(type, 7), right: laneValue(type, 2), expected: laneValue(type, 5) };
    case "mul":
      return { left: laneValue(type, 7), right: laneValue(type, 2), expected: laneValue(type, 14) };
    case "div":
      if (!integer) return { left: 7.5, right: 2.5, expected: 3 };
      if (signed) {
        return {
          left: laneValue(type, -7),
          right: laneValue(type, 2),
          expected: laneValue(type, -3),
        };
      }
      return {
        left: laneValue(type, -1),
        right: laneValue(type, 2),
        expected: i64 ? (1n << 63n) - 1n : 0x7fff_ffff,
      };
    case "rem":
      return signed
        ? { left: laneValue(type, -7), right: laneValue(type, 2), expected: laneValue(type, -1) }
        : { left: laneValue(type, -1), right: laneValue(type, 2), expected: laneValue(type, 1) };
    case "and":
      return { left: laneValue(type, 6), right: laneValue(type, 3), expected: laneValue(type, 2) };
    case "or":
      return { left: laneValue(type, 6), right: laneValue(type, 3), expected: laneValue(type, 7) };
    case "xor":
      return { left: laneValue(type, 6), right: laneValue(type, 3), expected: laneValue(type, 5) };
    case "shl":
      return { left: laneValue(type, 3), right: laneValue(type, 2), expected: laneValue(type, 12) };
    case "shr":
      return signed
        ? { left: laneValue(type, -8), right: laneValue(type, 1), expected: laneValue(type, -4) }
        : {
            left: laneValue(type, -1),
            right: laneValue(type, 1),
            expected: i64 ? (1n << 63n) - 1n : 0x7fff_ffff,
          };
    case "eq":
      return { left: laneValue(type, 3), right: laneValue(type, 3), expected: 1 };
    case "ne":
      return { left: laneValue(type, 3), right: laneValue(type, 4), expected: 1 };
    case "lt":
    case "le":
    case "gt":
    case "ge": {
      const left = integer ? laneValue(type, -1) : -1;
      const right = integer ? laneValue(type, 1) : 1;
      const unsignedInteger = integer && !signed;
      const expected =
        op === "lt" || op === "le" ? (unsignedInteger ? 0 : 1) : unsignedInteger ? 1 : 0;
      return { left, right, expected };
    }
    case "copysign":
      return { left: 3, right: -2, expected: -3 };
  }
}

export function* binopCases(): Generator<IrExecutionCase> {
  const ops: readonly BinOp[] = [
    "add",
    "sub",
    "mul",
    "div",
    "rem",
    "and",
    "or",
    "xor",
    "shl",
    "shr",
    "eq",
    "ne",
    "lt",
    "le",
    "gt",
    "ge",
    "copysign",
  ];
  const comparisons = new Set<BinOp>(["eq", "ne", "lt", "le", "gt", "ge"]);
  for (const op of ops) {
    for (const type of binopLanes(op)) {
      for (const signed of [true, false]) {
        const { left, right, expected } = binopOperands(op, type, signed);
        yield {
          name: `binop ${op} ${type} ${signed ? "signed" : "unsigned"}`,
          module: expressionModule(
            {
              k: "binop",
              op,
              type,
              signed,
              l: constant(type, left),
              r: constant(type, right),
            },
            comparisons.has(op) ? "i32" : type,
          ),
          entry: "run",
          expected,
        };
      }
    }
  }
}

export function* unopCases(): Generator<IrExecutionCase> {
  const inputs: Record<UnOp, number> = {
    eqz: 0,
    neg: 3.5,
    abs: -3.5,
    sqrt: 9,
    floor: 3.75,
    ceil: 3.25,
    trunc: -3.75,
    nearest: 2.5,
  };
  const expected: Record<UnOp, number> = {
    eqz: 1,
    neg: -3.5,
    abs: 3.5,
    sqrt: 3,
    floor: 3,
    ceil: 4,
    trunc: -3,
    nearest: 2,
  };
  const lanes: Record<UnOp, readonly IrType[]> = {
    eqz: INTEGER_LANES,
    neg: FLOAT_LANES,
    abs: FLOAT_LANES,
    sqrt: FLOAT_LANES,
    floor: FLOAT_LANES,
    ceil: FLOAT_LANES,
    trunc: FLOAT_LANES,
    nearest: FLOAT_LANES,
  };
  for (const op of Object.keys(lanes) as UnOp[]) {
    for (const type of lanes[op]) {
      yield {
        name: `unop ${op} ${type}`,
        module: expressionModule(
          { k: "unop", op, type, e: constant(type, laneValue(type, inputs[op])) },
          op === "eqz" ? "i32" : type,
        ),
        entry: "run",
        expected: op === "eqz" ? 1 : laneValue(type, expected[op]),
      };
    }
  }
}

export function* conversionCases(): Generator<IrExecutionCase> {
  const cases: ReadonlyArray<{
    op: ConvOp;
    source: IrType;
    result: IrType;
    value: number | bigint;
    expected: unknown;
  }> = [
    { op: "i32.wrap_i64", source: "i64", result: "i32", value: 0x1_0000_0007n, expected: 7 },
    { op: "i64.extend_i32_s", source: "i32", result: "i64", value: -7, expected: -7n },
    { op: "i64.extend_i32_u", source: "i32", result: "i64", value: -1, expected: 0xffff_ffffn },
    { op: "i32.trunc_f32_s", source: "f32", result: "i32", value: -7.75, expected: -7 },
    { op: "i32.trunc_f32_u", source: "f32", result: "i32", value: 7.75, expected: 7 },
    { op: "i32.trunc_f64_s", source: "f64", result: "i32", value: -7.75, expected: -7 },
    { op: "i32.trunc_f64_u", source: "f64", result: "i32", value: 7.75, expected: 7 },
    { op: "i64.trunc_f32_s", source: "f32", result: "i64", value: -7.75, expected: -7n },
    { op: "i64.trunc_f32_u", source: "f32", result: "i64", value: 7.75, expected: 7n },
    { op: "i64.trunc_f64_s", source: "f64", result: "i64", value: -7.75, expected: -7n },
    { op: "i64.trunc_f64_u", source: "f64", result: "i64", value: 7.75, expected: 7n },
    { op: "f32.convert_i32_s", source: "i32", result: "f32", value: -7, expected: -7 },
    {
      op: "f32.convert_i32_u",
      source: "i32",
      result: "f32",
      value: -1,
      expected: 2 ** 32,
    },
    { op: "f32.convert_i64_s", source: "i64", result: "f32", value: -7n, expected: -7 },
    {
      op: "f32.convert_i64_u",
      source: "i64",
      result: "f32",
      value: -1n,
      expected: 2 ** 64,
    },
    { op: "f64.convert_i32_s", source: "i32", result: "f64", value: -7, expected: -7 },
    {
      op: "f64.convert_i32_u",
      source: "i32",
      result: "f64",
      value: -1,
      expected: 0xffff_ffff,
    },
    { op: "f64.convert_i64_s", source: "i64", result: "f64", value: -7n, expected: -7 },
    {
      op: "f64.convert_i64_u",
      source: "i64",
      result: "f64",
      value: -1n,
      expected: 2 ** 64,
    },
    {
      op: "f32.demote_f64",
      source: "f64",
      result: "f32",
      value: 1.337,
      expected: Math.fround(1.337),
    },
    { op: "f64.promote_f32", source: "f32", result: "f64", value: 1.5, expected: 1.5 },
    { op: "i32.extend8_s", source: "i32", result: "i32", value: 0xff, expected: -1 },
    { op: "i32.extend16_s", source: "i32", result: "i32", value: 0xffff, expected: -1 },
    { op: "i64.extend8_s", source: "i64", result: "i64", value: 0xffn, expected: -1n },
    { op: "i64.extend16_s", source: "i64", result: "i64", value: 0xffffn, expected: -1n },
    {
      op: "i64.extend32_s",
      source: "i64",
      result: "i64",
      value: 0xffff_ffffn,
      expected: -1n,
    },
  ];
  for (const entry of cases) {
    yield {
      name: `convert ${entry.op}`,
      module: expressionModule(
        { k: "convert", op: entry.op, e: constant(entry.source, entry.value) },
        entry.result,
      ),
      entry: "run",
      expected: entry.expected,
    };
  }
}

function laneBytes(type: IrType, value: number | bigint): Uint8Array {
  const size = type === "i64" || type === "f64" ? 8 : 4;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  switch (type) {
    case "i32":
      view.setInt32(0, value as number, true);
      break;
    case "i64":
      view.setBigInt64(0, value as bigint, true);
      break;
    case "f32":
      view.setFloat32(0, value as number, true);
      break;
    case "f64":
      view.setFloat64(0, value as number, true);
      break;
  }
  return bytes;
}

export function* memoryAccessCases(): Generator<IrExecutionCase> {
  const fullValues: Record<IrType, number | bigint> = {
    i32: 0x1234_5678,
    i64: 0x0123_4567_89ab_cdefn,
    f32: 3.5,
    f64: -7.25,
  };
  for (const type of ALL_LANES) {
    const value = fullValues[type];
    yield {
      name: `load ${type} full`,
      module: moduleWith({
        types: [{ params: [], results: [type] }],
        funcs: [
          {
            sig: 0,
            locals: [],
            body: [
              {
                k: "return",
                values: [{ k: "load", type, addr: constant("i32", 0), offset: 0 }],
              },
            ],
            export: "run",
          },
        ],
        data: [{ addr: 0, bytes: laneBytes(type, value) }],
      }),
      entry: "run",
      expected: value,
    };
    yield {
      name: `store ${type} full`,
      module: moduleWith({
        types: [{ params: [], results: [type] }],
        funcs: [
          {
            sig: 0,
            locals: [],
            body: [
              {
                k: "store",
                type,
                addr: constant("i32", 0),
                value: constant(type, value),
                offset: 0,
              },
              {
                k: "return",
                values: [{ k: "load", type, addr: constant("i32", 0), offset: 0 }],
              },
            ],
            export: "run",
          },
        ],
      }),
      entry: "run",
      expected: value,
    };
  }
  for (const type of INTEGER_LANES) {
    for (const width of [8, 16] as const) {
      for (const signed of [true, false]) {
        const bytes = width === 8 ? Uint8Array.of(0xff) : Uint8Array.of(0xff, 0xff);
        const expected = signed
          ? laneValue(type, -1)
          : laneValue(type, width === 8 ? 0xff : 0xffff);
        yield {
          name: `load ${type} ${width} ${signed ? "signed" : "unsigned"}`,
          module: moduleWith({
            types: [{ params: [], results: [type] }],
            funcs: [
              {
                sig: 0,
                locals: [],
                body: [
                  {
                    k: "return",
                    values: [
                      {
                        k: "load",
                        type,
                        width,
                        signed,
                        addr: constant("i32", 0),
                        offset: 0,
                      },
                    ],
                  },
                ],
                export: "run",
              },
            ],
            data: [{ addr: 0, bytes }],
          }),
          entry: "run",
          expected,
        };
      }
      const value = laneValue(type, 0x1234);
      const expected = laneValue(type, width === 8 ? 0x34 : 0x1234);
      yield {
        name: `store ${type} ${width}`,
        module: moduleWith({
          types: [{ params: [], results: [type] }],
          funcs: [
            {
              sig: 0,
              locals: [],
              body: [
                {
                  k: "store",
                  type,
                  width,
                  addr: constant("i32", 0),
                  value: constant(type, value),
                  offset: 0,
                },
                {
                  k: "return",
                  values: [
                    {
                      k: "load",
                      type,
                      width,
                      signed: false,
                      addr: constant("i32", 0),
                      offset: 0,
                    },
                  ],
                },
              ],
              export: "run",
            },
          ],
        }),
        entry: "run",
        expected,
      };
    }
  }
}
