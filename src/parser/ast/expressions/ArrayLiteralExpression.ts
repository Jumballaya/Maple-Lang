import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { ASTExpression } from "../types/ast.type";

export class ArrayLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public elements: ASTExpression[];
  public location = 0;
  public memberType: string;

  constructor(token: Token, memberType: string, elements: ASTExpression[] = []) {
    this.token = token;
    this.elements = elements;
    this.memberType = memberType;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    const elements = this.elements.map((el) => el.toString()).join(", ");
    return `[ ${elements} ]`;
  }
}
