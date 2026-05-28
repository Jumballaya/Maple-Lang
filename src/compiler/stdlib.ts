import type { ModuleMeta } from "./emitters/emitter.types";

const math: ModuleMeta = {
  fnTable: new Map(),
  fnSignatures: new Map(),
  liftedLambdas: [],
  needsClosureRuntime: false,
  name: "math",
  dataPtr: 0,
  exports: {
    i_to_f: {
      kind: "func",
      signature: "i_f",
    },
    min_i32: {
      kind: "func",
      signature: "ii_i",
    },
    min_f32: {
      kind: "func",
      signature: "ff_f",
    },
    max_i32: {
      kind: "func",
      signature: "ii_i",
    },
    max_f32: {
      kind: "func",
      signature: "ff_f",
    },
    sqrt: { kind: "func", signature: "f_f" },
    abs_f32: { kind: "func", signature: "f_f" },
    abs_i32: { kind: "func", signature: "i_i" },
    floor: { kind: "func", signature: "f_f" },
    ceil: { kind: "func", signature: "f_f" },
    round: { kind: "func", signature: "f_f" },
    trunc: { kind: "func", signature: "f_f" },
    copysign: { kind: "func", signature: "ff_f" },
    sqrt_f64: { kind: "func", signature: "F_F" },
    abs_f64: { kind: "func", signature: "F_F" },
    floor_f64: { kind: "func", signature: "F_F" },
    ceil_f64: { kind: "func", signature: "F_F" },
    round_f64: { kind: "func", signature: "F_F" },
    trunc_f64: { kind: "func", signature: "F_F" },
    copysign_f64: { kind: "func", signature: "FF_F" },
    sin: { kind: "func", signature: "f_f" },
    cos: { kind: "func", signature: "f_f" },
    tan: { kind: "func", signature: "f_f" },
    atan2: { kind: "func", signature: "ff_f" },
    pow: { kind: "func", signature: "fi_f" },
    fmod: { kind: "func", signature: "ff_f" },
    PI: { kind: "global", type: "f32" },
    TWO_PI: { kind: "global", type: "f32" },
    HALF_PI: { kind: "global", type: "f32" },
    E: { kind: "global", type: "f32" },
    fraction: {
      kind: "struct",
      meta: {
        name: "fraction",
        size: 8,
        exported: true,
        members: {
          numerator: {
            name: "numerator",
            offset: 0,
            size: 4,
            type: "i32",
          },
          denominator: {
            name: "denominator",
            offset: 4,
            size: 4,
            type: "i32",
          },
        },
      },
    },
  },
  functions: {},
  globals: {},
  imports: {},
  stringPool: {},
  structs: {
    fraction: {
      name: "fraction",
      size: 8,
      exported: true,
      members: {
        numerator: {
          name: "numerator",
          offset: 0,
          size: 4,
          type: "i32",
        },
        denominator: {
          name: "denominator",
          offset: 4,
          size: 4,
          type: "i32",
        },
      },
    },
  },
  data: [],
  deferredGlobalInits: [],
};

const memory: ModuleMeta = {
  fnTable: new Map(),
  fnSignatures: new Map(),
  liftedLambdas: [],
  needsClosureRuntime: false,
  name: "memory",
  dataPtr: 0,
  exports: {
    malloc: {
      kind: "func",
      signature: "i_i",
    },
    free: {
      kind: "func",
      signature: "i_v",
    },
    realloc: {
      kind: "func",
      signature: "iii_i",
    },
    string_copy: {
      kind: "func",
      signature: "ii_v",
    },
  },
  functions: {},
  globals: {},
  imports: {},
  stringPool: {},
  structs: {},
  data: [],
  deferredGlobalInits: [],
};

const string: ModuleMeta = {
  fnTable: new Map(),
  fnSignatures: new Map(),
  liftedLambdas: [],
  needsClosureRuntime: false,
  name: "string",
  dataPtr: 0,
  exports: {
    string_copy: {
      kind: "func",
      signature: "ii_v",
    },
    string: {
      kind: "struct",
      meta: {
        name: "string",
        size: 8,
        exported: true,
        members: {
          len: {
            name: "len",
            offset: 0,
            size: 4,
            type: "i32",
          },
          data: {
            name: "data",
            offset: 4,
            size: 4,
            type: "i32",
          },
        },
      },
    },
  },
  functions: {},
  globals: {},
  imports: {},
  stringPool: {},
  structs: {
    string: {
      name: "string",
      size: 8,
      exported: true,
      members: {
        len: {
          name: "len",
          offset: 0,
          size: 4,
          type: "i32",
        },
        data: {
          name: "data",
          offset: 4,
          size: 4,
          type: "*u8",
        },
      },
    },
  },
  data: [],
  deferredGlobalInits: [],
};

export const stdlib: Record<string, ModuleMeta> = {
  math,
  memory,
  string,
};
