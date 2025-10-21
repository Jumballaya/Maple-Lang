import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class Identifier implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public typeAnnotation: string;
  public symbolId: number;

  constructor(token: Token, typeAnnotation: string, symbolId: number) {
    this.token = token;
    this.typeAnnotation = typeAnnotation;
    this.symbolId = symbolId;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    throw this.tokenLiteral();
  }
}
