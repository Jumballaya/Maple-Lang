import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { Identifier } from "../expressions/Identifier";
import type { ASTExpression, ASTStatement } from "../types/ast.type";

export class LetStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public identifier: Identifier;
  public expression: ASTExpression | null = null;
  public typeAnnotation: string;
  public exported;
  public mutable: boolean;

  constructor(
    token: Token,
    ident: Identifier,
    typeAnnotation: string,
    expr: ASTExpression | null = null,
    exported = false,
    mutable = true,
  ) {
    this.token = token;
    this.identifier = ident;
    this.expression = expr;
    this.typeAnnotation = typeAnnotation;
    this.exported = exported;
    this.mutable = mutable;
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
