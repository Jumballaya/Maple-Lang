import { ASTExpression } from "../../parser/ast/types/ast.type.js";
import type { VariableMeta } from "./emitter.types.js";

// @TODO: Eventually this information will get captured and not infered like this
export function asExpr(x: string | number): ASTExpression {
  if (typeof x === "string") {
    return { type: "identifier", value: x };
  }
  if (Number.isInteger(x)) {
    return { type: "integer_literal", value: x };
  }
  return { type: "float_literal", value: x };
}

export function addrOf(v: VariableMeta): string {
  if (v.addr != null) {
    return `(i32.const ${v.addr})`;
  }
  throw new Error(`address required for memory variable: "${v.name}"`);
}

let n = 0;
export function makeLabel(prefix: string) {
  return `$${prefix}_${n++}`;
}
