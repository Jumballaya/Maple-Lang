import type { Token } from "../../../lexer/token.types";
import type { ASTExpression } from "../types/ast.type";

export class CastExpression implements ASTExpression {
  type = "expression" as const;

  constructor(
    public token: Token,
    public expr: ASTExpression,
    public targetType: string,
  ) {}

  tokenLiteral(): string {
    return this.token.literal.toString();
  }

  toString(): string {
    return `(${this.expr.toString()} as ${this.targetType})`;
  }
}
