import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class InfixExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public operator: string;
  public left: ASTExpression;
  public right: ASTExpression;

  constructor(
    token: Token,
    operator: string,
    left: ASTExpression,
    right: ASTExpression
  ) {
    this.token = token;
    this.operator = operator;
    this.left = left;
    this.right = right;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    return `(${this.left.toString()} ${this.operator} ${this.right.toString()})`;
  }
}
