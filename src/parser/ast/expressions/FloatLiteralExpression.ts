import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { ASTExpression } from "../types/ast.type";

export class FloatLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public value: number;
  public numericType: "f32" | "f64" = "f32";

  constructor(token: Token, value: number) {
    this.token = token;
    this.value = value;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    return this.value.toString();
  }
}
