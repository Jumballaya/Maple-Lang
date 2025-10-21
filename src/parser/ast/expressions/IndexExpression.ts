import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class IndexExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public left: ASTExpression;
  public index: ASTExpression;

  constructor(token: Token, left: ASTExpression, index: ASTExpression) {
    this.token = token;
    this.left = left;
    this.index = index;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    const { left, index } = this;
    return `${left}[${index}]`;
  }
}
