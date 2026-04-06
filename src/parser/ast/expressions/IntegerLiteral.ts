import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { ASTExpression } from "../types/ast.type";

export class IntegerLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public value: number;
  /** Set by parser when a typed context uses a 64-bit integer lane (e.g. `let x: i64 = 1`). */
  public numericType: "i32" | "i64" = "i32";

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
