import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { Identifier } from "../expressions/Identifier";
import type { ASTExpression, ASTStatement } from "../types/ast.type";
import { TuplePattern } from "./TuplePattern";

export class LetStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public pattern: Identifier | TuplePattern;
  public expression: ASTExpression | null = null;
  public typeAnnotation: string;
  public exported;
  public mutable: boolean;
  // Unique WASM local name stamped by the emitter's locals pass; differs
  // from the source name when this declaration shadows (`x@1`).
  public resolvedName?: string;
  public resolvedNames?: (string | null)[]; // tuple patterns; null = discard

  constructor(
    token: Token,
    pattern: Identifier | TuplePattern,
    typeAnnotation: string,
    expr: ASTExpression | null = null,
    exported = false,
    mutable = true,
  ) {
    this.token = token;
    this.pattern = pattern;
    this.expression = expr;
    this.typeAnnotation = typeAnnotation;
    this.exported = exported;
    this.mutable = mutable;
  }

  /**
   * @deprecated Use pattern instead.
   */
  public get identifier(): Identifier {
    if (this.pattern instanceof TuplePattern) {
      throw new Error(
        "LetStatement.identifier accessed on a destructure let; use LetStatement.pattern",
      );
    }
    return this.pattern;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    const ident = this.pattern.toString();
    const type = this.typeAnnotation;
    const value = this.expression?.toString();
    const keyword = this.mutable ? "let" : "const";
    if (this.pattern instanceof TuplePattern) {
      return `${"\t".repeat(tab_level)}${keyword} ${ident} = ${value};`;
    }
    return `${"\t".repeat(tab_level)}${keyword} ${ident}: ${type} = ${value};`;
  }
}
