import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class StringLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public value: string;

  constructor(token: Token, value: string) {
    this.token = token;
    this.value = value;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    return this.value;
  }
}
