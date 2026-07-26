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

export type CrosscheckCase = {
  name: string;
  module: IrModule;
  entry?: string;
  args?: Array<number | bigint>;
  imports?: () => WebAssembly.Imports;
  observe?: (instance: WebAssembly.Instance, imports: WebAssembly.Imports) => unknown;
};

export const ADOPTED_PRINTER_CASE_NAMES = [
  "printer expression const",
  "printer expression local.get",
  "printer expression global.get",
  "printer expression binop",
  "printer expression unop",
  "printer expression convert",
  "printer expression load",
  "printer expression call",
  "printer expression call_indirect",
  "printer expression if_val",
  "printer expression seq",
  "printer expression memory.size",
  "printer expression memory.grow",
  "printer constants f32 NaN",
  "printer constants f32 positive infinity",
  "printer constants f32 negative infinity",
  "printer constants f64 NaN",
  "printer constants f64 positive infinity",
  "printer constants f64 negative infinity",
  "printer constants i64 max",
  "printer constants f64 negative zero",
  "printer constants u32 max bits",
  "printer constants u64 max bits",
  "printer statement local.set (instantiation only)",
  "printer statement global.set (instantiation only)",
  "printer statement store (instantiation only)",
  "printer statement call (instantiation only)",
  "printer statement drop (instantiation only)",
  "printer statement multi_call (instantiation only)",
  "printer statement call_indirect (instantiation only)",
  "printer statement if (instantiation only)",
  "printer statement block (instantiation only)",
  "printer statement loop (instantiation only)",
  "printer statement br (instantiation only)",
  "printer statement br_if (instantiation only)",
  "printer statement return (instantiation only)",
  "printer statement unreachable (instantiation only)",
  "printer statement memory.copy (instantiation only)",
] as const;

export const MODULE_SURFACE_CASE_NAMES = [
  "surface owned memory",
  "surface imported memory",
  "surface table absent",
  "surface table empty",
  "surface table populated",
  "surface successful start",
  "surface names",
  "surface hostile UTF-8 host names",
  "surface data segments",
  "surface function and global imports",
  "surface trapping start",
  "surface trapping call",
  "surface canonical f32 NaN bits",
  "surface canonical f64 NaN bits",
] as const;

export const FAILURE_CASE_NAMES = [
  "failure missing function import",
  "failure wrong-kind global import",
  "failure missing memory import",
  "failure too-small memory import",
] as const;

function generatedCrosscheckCases(): CrosscheckCase[] {
  const generated = [...binopCases(), ...unopCases(), ...conversionCases(), ...memoryAccessCases()];
  return generated.map((entry) => ({
    name: entry.name,
    module: entry.module,
    entry: entry.entry,
    ...(entry.args === undefined ? {} : { args: entry.args }),
  }));
}

function adoptedPrinterCases(): CrosscheckCase[] {
  const directCall = moduleWith({
    types: [{ params: [], results: ["i32"] }],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [constant("i32", 8)] }],
      },
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [{ k: "call", fn: 0, args: [] }] }],
        export: "run",
      },
    ],
  });
  const indirectCall = structuredClone(directCall);
  indirectCall.table = { entries: [0] };
  indirectCall.funcs[1]!.body = [
    {
      k: "return",
      values: [{ k: "call_indirect", sig: 0, args: [], index: constant("i32", 0) }],
    },
  ];
  const nonFinite = moduleWith({
    types: [
      { params: [], results: ["f32"] },
      { params: [], results: ["f64"] },
    ],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [constant("f32", Number.NaN)] }],
        export: "nan32",
      },
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [constant("f32", Number.POSITIVE_INFINITY)] }],
        export: "inf32",
      },
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [constant("f32", Number.NEGATIVE_INFINITY)] }],
        export: "neg_inf32",
      },
      {
        sig: 1,
        locals: [],
        body: [{ k: "return", values: [constant("f64", Number.NaN)] }],
        export: "nan64",
      },
      {
        sig: 1,
        locals: [],
        body: [{ k: "return", values: [constant("f64", Number.POSITIVE_INFINITY)] }],
        export: "inf64",
      },
      {
        sig: 1,
        locals: [],
        body: [{ k: "return", values: [constant("f64", Number.NEGATIVE_INFINITY)] }],
        export: "neg_inf64",
      },
    ],
  });
  const integerBoundaries = moduleWith({
    types: [
      { params: [], results: ["i64"] },
      { params: [], results: ["f64"] },
      { params: [], results: ["i32"] },
    ],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [constant("i64", (1n << 63n) - 1n)] }],
        export: "i64_max",
      },
      {
        sig: 1,
        locals: [],
        body: [{ k: "return", values: [constant("f64", -0)] }],
        export: "negative_zero",
      },
      {
        sig: 2,
        locals: [],
        body: [{ k: "return", values: [constant("i32", -1)] }],
        export: "u32_max",
      },
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [constant("i64", -1n)] }],
        export: "u64_max",
      },
    ],
  });
  const multiCall = moduleWith({
    types: [
      { params: [], results: ["i32", "i64"] },
      { params: [], results: [] },
    ],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [{ k: "return", values: [constant("i32", 1), constant("i64", 2n)] }],
      },
      {
        sig: 1,
        locals: [],
        body: [{ k: "multi_call", callee: { kind: "func", fn: 0 }, args: [], targets: null }],
      },
      {
        sig: 1,
        locals: ["i32", "i64"],
        body: [{ k: "multi_call", callee: { kind: "func", fn: 0 }, args: [], targets: [0, 1] }],
      },
      {
        sig: 1,
        locals: [],
        body: [
          {
            k: "multi_call",
            callee: { kind: "indirect", sig: 0, index: constant("i32", 0) },
            args: [],
            targets: null,
          },
        ],
      },
      {
        sig: 1,
        locals: ["i32", "i64"],
        body: [
          {
            k: "multi_call",
            callee: { kind: "indirect", sig: 0, index: constant("i32", 0) },
            args: [],
            targets: [0, 1],
          },
        ],
      },
    ],
    table: { entries: [0] },
  });
  const indirectStatement = moduleWith({
    funcs: [
      { sig: 0, locals: [], body: [] },
      {
        sig: 0,
        locals: [],
        body: [{ k: "call_indirect", sig: 0, args: [], index: constant("i32", 0) }],
      },
    ],
    table: { entries: [0] },
  });
  const mutableGlobal = statementModule({ k: "global.set", id: 0, e: constant("i32", 1) });
  mutableGlobal.globals = [
    { type: "i32", mutable: true, init: { k: "const", type: "i32", value: 0 } },
  ];

  return [
    {
      name: "printer expression const",
      module: expressionModule(constant("i32", 1), "i32"),
      entry: "run",
    },
    {
      name: "printer expression local.get",
      module: moduleWith({
        types: [{ params: ["i32"], results: ["i32"] }],
        funcs: [
          {
            sig: 0,
            locals: [],
            body: [{ k: "return", values: [{ k: "local.get", id: 0 }] }],
            export: "run",
          },
        ],
      }),
      entry: "run",
      args: [41],
    },
    {
      name: "printer expression global.get",
      module: moduleWith({
        types: [{ params: [], results: ["i32"] }],
        funcs: [
          {
            sig: 0,
            locals: [],
            body: [{ k: "return", values: [{ k: "global.get", id: 0 }] }],
            export: "run",
          },
        ],
        globals: [{ type: "i32", mutable: false, init: { k: "const", type: "i32", value: 12 } }],
      }),
      entry: "run",
    },
    {
      name: "printer expression binop",
      module: expressionModule(
        {
          k: "binop",
          op: "add",
          type: "i32",
          signed: true,
          l: constant("i32", 20),
          r: constant("i32", 22),
        },
        "i32",
      ),
      entry: "run",
    },
    {
      name: "printer expression unop",
      module: expressionModule(
        { k: "unop", op: "neg", type: "f64", e: constant("f64", 3.5) },
        "f64",
      ),
      entry: "run",
    },
    {
      name: "printer expression convert",
      module: expressionModule(
        { k: "convert", op: "i32.wrap_i64", e: constant("i64", 0x1_0000_0007n) },
        "i32",
      ),
      entry: "run",
    },
    {
      name: "printer expression load",
      module: expressionModule(
        { k: "load", type: "i32", addr: constant("i32", 0), offset: 0 },
        "i32",
      ),
      entry: "run",
    },
    { name: "printer expression call", module: directCall, entry: "run" },
    { name: "printer expression call_indirect", module: indirectCall, entry: "run" },
    {
      name: "printer expression if_val",
      module: expressionModule(
        {
          k: "if_val",
          cond: constant("i32", 1),
          then: constant("i32", 2),
          else: constant("i32", 3),
          type: "i32",
        },
        "i32",
      ),
      entry: "run",
    },
    {
      name: "printer expression seq",
      module: expressionModule(
        {
          k: "seq",
          stmts: [{ k: "drop", e: constant("i32", 0) }],
          value: constant("i32", 1),
        },
        "i32",
      ),
      entry: "run",
    },
    {
      name: "printer expression memory.size",
      module: expressionModule({ k: "memory.size" }, "i32"),
      entry: "run",
    },
    {
      name: "printer expression memory.grow",
      module: expressionModule({ k: "memory.grow", pages: constant("i32", 0) }, "i32"),
      entry: "run",
    },
    { name: "printer constants f32 NaN", module: nonFinite, entry: "nan32" },
    {
      name: "printer constants f32 positive infinity",
      module: nonFinite,
      entry: "inf32",
    },
    {
      name: "printer constants f32 negative infinity",
      module: nonFinite,
      entry: "neg_inf32",
    },
    { name: "printer constants f64 NaN", module: nonFinite, entry: "nan64" },
    {
      name: "printer constants f64 positive infinity",
      module: nonFinite,
      entry: "inf64",
    },
    {
      name: "printer constants f64 negative infinity",
      module: nonFinite,
      entry: "neg_inf64",
    },
    { name: "printer constants i64 max", module: integerBoundaries, entry: "i64_max" },
    {
      name: "printer constants f64 negative zero",
      module: integerBoundaries,
      entry: "negative_zero",
    },
    {
      name: "printer constants u32 max bits",
      module: integerBoundaries,
      entry: "u32_max",
    },
    {
      name: "printer constants u64 max bits",
      module: integerBoundaries,
      entry: "u64_max",
    },
    {
      name: "printer statement local.set (instantiation only)",
      module: statementModule({ k: "local.set", id: 0, e: constant("i32") }, ["i32"]),
    },
    {
      name: "printer statement global.set (instantiation only)",
      module: mutableGlobal,
    },
    {
      name: "printer statement store (instantiation only)",
      module: statementModule({
        k: "store",
        type: "i32",
        addr: constant("i32"),
        value: constant("i32"),
        offset: 0,
      }),
    },
    {
      name: "printer statement call (instantiation only)",
      module: moduleWith({
        funcs: [
          { sig: 0, locals: [], body: [] },
          { sig: 0, locals: [], body: [{ k: "call", fn: 0, args: [] }] },
        ],
      }),
    },
    {
      name: "printer statement drop (instantiation only)",
      module: statementModule({ k: "drop", e: constant("i32") }),
    },
    {
      name: "printer statement multi_call (instantiation only)",
      module: multiCall,
    },
    {
      name: "printer statement call_indirect (instantiation only)",
      module: indirectStatement,
    },
    {
      name: "printer statement if (instantiation only)",
      module: statementModule({ k: "if", cond: constant("i32"), then: [], else: [] }),
    },
    {
      name: "printer statement block (instantiation only)",
      module: statementModule({ k: "block", label: 1, body: [] }),
    },
    {
      name: "printer statement loop (instantiation only)",
      module: statementModule({ k: "loop", label: 1, body: [] }),
    },
    {
      name: "printer statement br (instantiation only)",
      module: statementModule({
        k: "block",
        label: 1,
        body: [{ k: "br", label: 1 }],
      }),
    },
    {
      name: "printer statement br_if (instantiation only)",
      module: statementModule({
        k: "block",
        label: 1,
        body: [{ k: "br_if", label: 1, cond: constant("i32") }],
      }),
    },
    {
      name: "printer statement return (instantiation only)",
      module: statementModule({ k: "return", values: [] }),
    },
    {
      name: "printer statement unreachable (instantiation only)",
      module: statementModule({ k: "unreachable" }),
    },
    {
      name: "printer statement memory.copy (instantiation only)",
      module: statementModule({
        k: "memory.copy",
        dest: constant("i32"),
        src: constant("i32"),
        len: constant("i32"),
      }),
    },
  ];
}

function canonicalNanModule(floatType: "f32" | "f64"): IrModule {
  const intType = floatType === "f32" ? "i32" : "i64";
  return moduleWith({
    types: [{ params: [], results: [intType] }],
    funcs: [
      {
        sig: 0,
        locals: [],
        body: [
          {
            k: "store",
            type: floatType,
            addr: constant("i32", 0),
            value: constant(floatType, Number.NaN),
            offset: 0,
          },
          {
            k: "return",
            values: [{ k: "load", type: intType, addr: constant("i32", 0), offset: 0 }],
          },
        ],
        export: "bits",
      },
    ],
  });
}

function moduleSurfaceCases(): CrosscheckCase[] {
  const hostileModule = 'm"\\\n☃';
  const hostileField = 'n\0"x';
  const hostileExport = 'run"\\\n☃';
  return [
    {
      name: "surface owned memory",
      module: moduleWith({ types: [], memory: { initialPages: 2, mode: "owned" } }),
      observe: (instance) =>
        (instance.exports.memory as WebAssembly.Memory).buffer.byteLength / 65_536,
    },
    {
      name: "surface imported memory",
      module: moduleWith({ types: [], memory: { initialPages: 2, mode: "imported" } }),
      imports: () => ({
        runtime: { memory: new WebAssembly.Memory({ initial: 2 }) },
      }),
      observe: (_instance, imports) =>
        (imports.runtime!.memory as WebAssembly.Memory).buffer.byteLength / 65_536,
    },
    { name: "surface table absent", module: moduleWith({}) },
    { name: "surface table empty", module: moduleWith({ table: { entries: [] } }) },
    {
      name: "surface table populated",
      module: moduleWith({
        funcs: [{ sig: 0, locals: [], body: [] }],
        table: { entries: [0] },
      }),
    },
    {
      name: "surface successful start",
      module: moduleWith({
        types: [
          { params: [], results: [] },
          { params: [], results: ["i32"] },
        ],
        funcs: [
          {
            sig: 0,
            locals: [],
            body: [{ k: "global.set", id: 0, e: constant("i32", 9) }],
          },
          {
            sig: 1,
            locals: [],
            body: [{ k: "return", values: [{ k: "global.get", id: 0 }] }],
            export: "read",
          },
        ],
        globals: [
          {
            type: "i32",
            mutable: true,
            init: { k: "const", type: "i32", value: 0 },
            export: "started",
          },
        ],
        start: 0,
      }),
      entry: "read",
      observe: (instance) => (instance.exports.started as WebAssembly.Global).value,
    },
    {
      name: "surface names",
      module: moduleWith({
        types: [{ params: ["i32"], results: ["i32"] }],
        funcs: [
          {
            sig: 0,
            locals: ["i32"],
            body: [{ k: "return", values: [{ k: "local.get", id: 0 }] }],
            export: "run",
          },
        ],
        globals: [
          {
            type: "i32",
            mutable: false,
            init: { k: "const", type: "i32", value: 7 },
            export: "count",
          },
        ],
        funcNames: [[0, "namedFn"]],
        globalNames: [[0, "namedGlobal"]],
        localNames: [
          [
            0,
            [
              [0, "param"],
              [1, "local"],
            ],
          ],
        ],
      }),
      entry: "run",
      args: [7],
    },
    {
      name: "surface hostile UTF-8 host names",
      module: moduleWith({
        types: [{ params: [], results: ["i32"] }],
        funcImports: [{ module: hostileModule, name: hostileField, sig: 0 }],
        funcs: [
          {
            sig: 0,
            locals: [],
            body: [{ k: "return", values: [{ k: "call", fn: 0, args: [] }] }],
            export: hostileExport,
          },
        ],
        funcNames: [
          [0, "imported"],
          [1, "runner"],
        ],
      }),
      entry: hostileExport,
      imports: () => ({ [hostileModule]: { [hostileField]: () => 31 } }),
    },
    {
      name: "surface data segments",
      module: moduleWith({
        types: [],
        data: [
          { addr: 2, bytes: Uint8Array.of(1, 2, 3) },
          { addr: 7, bytes: Uint8Array.of(4, 5) },
        ],
      }),
      observe: (instance) => [
        ...new Uint8Array((instance.exports.memory as WebAssembly.Memory).buffer, 0, 9),
      ],
    },
    {
      name: "surface function and global imports",
      module: moduleWith({
        types: [{ params: [], results: ["i32"] }],
        funcImports: [{ module: "host", name: "answer", sig: 0 }],
        globalImports: [{ module: "env", name: "g", type: "i32" }],
        funcs: [
          {
            sig: 0,
            locals: [],
            body: [
              {
                k: "return",
                values: [
                  {
                    k: "binop",
                    op: "add",
                    type: "i32",
                    signed: true,
                    l: { k: "call", fn: 0, args: [] },
                    r: { k: "global.get", id: 0 },
                  },
                ],
              },
            ],
            export: "run",
          },
        ],
      }),
      entry: "run",
      imports: () => ({ host: { answer: () => 5 }, env: { g: 7 } }),
    },
    {
      name: "surface trapping start",
      module: moduleWith({
        funcs: [{ sig: 0, locals: [], body: [{ k: "unreachable" }] }],
        start: 0,
      }),
    },
    {
      name: "surface trapping call",
      module: moduleWith({
        funcs: [{ sig: 0, locals: [], body: [{ k: "unreachable" }], export: "run" }],
      }),
      entry: "run",
    },
    {
      name: "surface canonical f32 NaN bits",
      module: canonicalNanModule("f32"),
      entry: "bits",
    },
    {
      name: "surface canonical f64 NaN bits",
      module: canonicalNanModule("f64"),
      entry: "bits",
    },
  ];
}

function failureCases(): CrosscheckCase[] {
  return [
    {
      name: "failure missing function import",
      module: moduleWith({
        funcImports: [{ module: "host", name: "missing", sig: 0 }],
      }),
      imports: () => ({ host: {} }),
    },
    {
      name: "failure wrong-kind global import",
      module: moduleWith({
        types: [],
        globalImports: [{ module: "host", name: "g", type: "i32" }],
      }),
      imports: () => ({ host: { g: () => 0 } }),
    },
    {
      name: "failure missing memory import",
      module: moduleWith({
        types: [],
        memory: { initialPages: 2, mode: "imported" },
      }),
      imports: () => ({ runtime: {} }),
    },
    {
      name: "failure too-small memory import",
      module: moduleWith({
        types: [],
        memory: { initialPages: 2, mode: "imported" },
      }),
      imports: () => ({
        runtime: { memory: new WebAssembly.Memory({ initial: 1 }) },
      }),
    },
  ];
}

export const crosscheckCases: ReadonlyArray<CrosscheckCase> = [
  ...generatedCrosscheckCases(),
  ...adoptedPrinterCases(),
  ...moduleSurfaceCases(),
  ...failureCases(),
];
