import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class IntegerLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public value: number;

  constructor(token: Token) {
    this.token = token;
    const literal = token.literal;
    if (typeof literal === "number") {
      this.value = literal;
    } else {
      const parsed = parseInt(extractTokenLiteral(token), 10);
      this.value = Number.isNaN(parsed) ? 0 : parsed;
    }
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    return this.tokenLiteral();
  }
}
