import type { ASTExpression } from "../../../parser/ast/types/ast.type";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { valueTypeToWasm, wasmLoadOp, wasmStoreOp } from "../emit.types";
import { addrOf } from "../emitter.utils";
import { emitExpression } from "./expression";

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
      const loadOp = wasmLoadOp(v.type);
      return `(${loadOp} ${addrOf(v)})`;
    }
  }
}

export function emitSet(ident: string, expr: ASTExpression, emitter: ModuleEmitter): string {
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
      const storeOp = wasmStoreOp(v.type);
      return `(${storeOp} ${addrOf(v)} ${rhs})`;
    }
  }
}

export function emitNumberGet(num: number, type: string): string {
  const wt = valueTypeToWasm(type);
  return `(${wt}.const ${num})`;
}
