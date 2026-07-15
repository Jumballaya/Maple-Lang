import type { ModuleMeta } from "./emitters/emitter.types";

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

export const stdlib: Record<string, ModuleMeta> = {
  memory,
};
