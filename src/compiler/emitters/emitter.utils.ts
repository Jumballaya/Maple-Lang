import type { Token } from "../../lexer/token.types";
import { FloatLiteralExpression } from "../../parser/ast/expressions/FloatLiteralExpression";
import { Identifier } from "../../parser/ast/expressions/Identifier";
import { IntegerLiteralExpression } from "../../parser/ast/expressions/IntegerLiteral";
import type { ASTExpression } from "../../parser/ast/types/ast.type";
import type { VariableMeta } from "./emitter.types";

// @TODO: Eventually this information will get captured and not infered like this
export function asExpr(x: string | number): ASTExpression {
  if (typeof x === "string") {
    return new Identifier(
      { type: "Identifier", literal: x, col: 0, line: 0, end: 0, start: 0 },
      "i32",
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

export function resetLabels(): void {
  n = 0;
}

export function makeLabel(prefix: string) {
  return `$${prefix}_${n++}`;
}
