import { ModuleMeta } from "./emitters/emitter.types";

const math: ModuleMeta = {
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
};

const memory: ModuleMeta = {
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
      signature: "i_i",
    },
  },
  functions: {},
  globals: {},
  imports: {},
  stringPool: {},
  structs: {},
  data: [],
};

const string: ModuleMeta = {
  name: "string",
  dataPtr: 0,
  exports: {
    string_copy: {
      kind: "func",
      signature: "i_v",
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
};

export const stdlib: Record<string, ModuleMeta> = {
  math,
  memory,
  string,
};
