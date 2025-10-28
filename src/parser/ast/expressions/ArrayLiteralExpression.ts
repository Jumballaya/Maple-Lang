import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class ArrayLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public elements: number[]; // @TODO: implement arrays of other things, or make everything work as an array of numbers
  public location = 0;
  public memberType: string;

  constructor(token: Token, memberType: string, elements: number[] = []) {
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
