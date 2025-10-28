import { Token } from "../../lexer/token.types.js";
import { FloatLiteralExpression } from "../../parser/ast/expressions/FloatLiteralExpression.js";
import { Identifier } from "../../parser/ast/expressions/Identifier.js";
import { IntegerLiteralExpression } from "../../parser/ast/expressions/IntegerLiteral.js";
import { ASTExpression } from "../../parser/ast/types/ast.type.js";
import type { VariableMeta } from "./emitter.types.js";

// @TODO: Eventually this information will get captured and not infered like this
export function asExpr(x: string | number): ASTExpression {
  if (typeof x === "string") {
    return new Identifier(
      { type: "Identifier", literal: x, col: 0, line: 0, end: 0, start: 0 },
      "i32"
    );
  }
  if (Number.isInteger(x)) {
    const tok: Token = {
      type: "IntegerLiteral",
      literal: x,
      col: 0,
      line: 0,
      end: 0,
      start: 0,
    };
    return new IntegerLiteralExpression(tok, x);
  }
  const tok: Token = {
    type: "FloatLiteral",
    literal: x,
    col: 0,
    line: 0,
    end: 0,
    start: 0,
  };
  return new FloatLiteralExpression(tok, x);
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
