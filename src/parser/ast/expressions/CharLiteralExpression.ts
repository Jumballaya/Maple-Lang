import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class CharLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public value: number;

  constructor(token: Token, value: number) {
    this.token = token;
    this.value = value;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    return String.fromCharCode(this.value);
  }
}
