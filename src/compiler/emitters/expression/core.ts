import { ASTExpression } from "../../../parser/ast/types/ast.type.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { valueTypeToWasm, wasmLoadOp, wasmStoreOp } from "../emit.types.js";
import { addrOf } from "../emitter.utils.js";
import { emitExpression } from "./expression.js";

export function emitGet(ident: string, emitter: ModuleEmitter): string {
  const v = emitter.getVar(ident);
  if (!v) {
    throw new Error(`variable not found: "${ident}"`);
  }

  switch (v.scope) {
    case "local":
    case "param": {
      return `(local.get $${ident})`;
    }

    case "global": {
      return `(global.get $${ident})`;
    }

    case "memory": {
      const wt = valueTypeToWasm(v.type);
      const loadOp = wasmLoadOp(wt);
      return `(${loadOp} ${addrOf(v)})`;
    }
  }
}

export function emitSet(
  ident: string,
  expr: ASTExpression,
  emitter: ModuleEmitter
): string {
  const v = emitter.getVar(ident);
  if (!v) throw new Error(`variable not found: "${ident}"`);

  const rhs = emitExpression(expr, emitter);

  switch (v.scope) {
    case "local":
    case "param": {
      return `(local.set $${ident} ${rhs})`;
    }

    case "global": {
      return `(global.set $${ident} ${rhs})`;
    }

    case "memory": {
      const wt = valueTypeToWasm(v.type);
      const storeOp = wasmStoreOp(wt);
      return `(${storeOp} ${addrOf(v)} ${rhs})`;
    }
  }
}

export function emitNumberGet(num: number, type: string): string {
  const wt = valueTypeToWasm(type);
  return `(${wt}.const ${num})`;
}
