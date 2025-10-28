import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { Identifier } from "../expressions/Identifier";
import { ASTExpression, ASTStatement } from "../types/ast.type";

export class LetStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public identifier: Identifier;
  public expression: ASTExpression | null = null;
  public typeAnnotation: string;
  public exported;

  constructor(
    token: Token,
    ident: Identifier,
    typeAnnotation: string,
    expr: ASTExpression | null = null,
    exported = false
  ) {
    this.token = token;
    this.identifier = ident;
    this.expression = expr;
    this.typeAnnotation = typeAnnotation;
    this.exported = exported;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    const ident = this.identifier.toString();
    const type = this.typeAnnotation;
    const value = this.expression?.toString();
    return `${"\t".repeat(tab_level)}let ${ident}: ${type} = ${value};`;
  }
}
