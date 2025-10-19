import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class ArrayLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;

  constructor(token: Token) {
    this.token = token;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    throw new Error("Not implemented");
  }
}
