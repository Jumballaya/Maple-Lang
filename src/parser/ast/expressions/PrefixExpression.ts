import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class PrefixExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public operator: string;
  public right: ASTExpression | null = null;

  constructor(
    token: Token,
    operator: string,
    right: ASTExpression | null = null
  ) {
    this.token = token;
    this.operator = operator;
    this.right = right;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    return `${this.operator}${this.right?.toString() || ""}`;
  }
}
