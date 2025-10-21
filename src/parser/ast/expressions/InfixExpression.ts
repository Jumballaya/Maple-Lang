import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class InfixExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public left: ASTExpression;
  public right: ASTExpression;
  public operator: string;

  constructor(
    token: Token,
    left: ASTExpression,
    operator: string,
    right: ASTExpression
  ) {
    this.token = token;
    this.left = left;
    this.operator = operator;
    this.right = right;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    const { left, operator, right } = this;
    return `${left.toString()} ${operator} ${right.toString()}`;
  }
}
