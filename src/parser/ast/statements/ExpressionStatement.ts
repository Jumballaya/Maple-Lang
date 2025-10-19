import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression, ASTStatement } from "../types/ast.type";

export class ExpressionStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public expression: ASTExpression | null = null;

  constructor(token: Token, expression: ASTExpression | null = null) {
    this.token = token;
    this.expression = expression;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    return this.expression?.toString() ?? "";
  }
}
