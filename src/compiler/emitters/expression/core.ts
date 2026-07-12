import type { ASTExpression } from "../../../parser/ast/types/ast.type";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { valueTypeToWasm, wasmLoadOp, wasmStoreOp } from "../emit.types";
import { addrOf } from "../emitter.utils";
import { emitExpression } from "./expression";

export function emitGet(ident: string, emitter: ModuleEmitter): string {
  const v = emitter.getVar(ident);
  if (v) {
    switch (v.scope) {
      case "local":
      case "param": {
        return `(local.get $${v.name})`;
      }

      case "global": {
        return `(global.get $${v.name})`;
      }

      case "memory": {
        const loadOp = wasmLoadOp(v.type);
        return `(${loadOp} ${addrOf(v)})`;
      }

      case "env":
        throw new Error(`[emitGet] env-captured '${ident}' not yet supported`);
    }
  }

  const fnEntry = emitter.ctx.mod.fnTable.get(ident);
  if (fnEntry) {
    return `(call $__make_fnref (i32.const ${fnEntry.slot}))`;
  }

  throw new Error(`variable not found: "${ident}"`);
}

export function emitSet(ident: string, expr: ASTExpression, emitter: ModuleEmitter): string {
  const v = emitter.getVar(ident);
  if (!v) throw new Error(`variable not found: "${ident}"`);

  const rhs = emitExpression(expr, emitter);

  switch (v.scope) {
    case "local":
    case "param": {
      return `(local.set $${v.name} ${rhs})`;
    }

    case "global": {
      return `(global.set $${v.name} ${rhs})`;
    }

    case "memory": {
      const storeOp = wasmStoreOp(v.type);
      return `(${storeOp} ${addrOf(v)} ${rhs})`;
    }

    case "env":
      throw new Error(`[emitSet] env-captured '${ident}' not yet supported`);
  }
}

export function emitNumberGet(num: number, type: string): string {
  const wt = valueTypeToWasm(type);
  return `(${wt}.const ${num})`;
}
