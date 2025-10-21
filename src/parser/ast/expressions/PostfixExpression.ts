import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class PostfixExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public left: ASTExpression | null = null;
  public operator: string;

  constructor(
    token: Token,
    left: ASTExpression | null = null,
    operator: string
  ) {
    this.token = token;
    this.left = left;
    this.operator = operator;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    return `${this.left?.toString() || ""}${this.operator}`;
  }
}
