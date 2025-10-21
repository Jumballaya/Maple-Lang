import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class InfixExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public left: ASTExpression;
  public value: ASTExpression | null = null;

  constructor(
    token: Token,
    left: ASTExpression,
    value: ASTExpression | null = null
  ) {
    this.token = token;
    this.left = left;
    this.value = value;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    const { left, value } = this;
    return `${left.toString()} = ${value?.toString() ?? ""}`;
  }
}
