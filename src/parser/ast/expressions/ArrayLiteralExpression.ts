import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class ArrayLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public elements: ASTExpression[];

  constructor(token: Token, elements: ASTExpression[] = []) {
    this.token = token;
    this.elements = elements;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    const elements = this.elements.map((el) => el.toString()).join(", ");
    return `[ ${elements} ]`;
  }
}
