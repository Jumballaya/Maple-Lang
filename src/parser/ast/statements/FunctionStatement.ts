import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { FunctionLiteralExpression } from "../expressions/FunctionLiteralExpression";
import type { ASTStatement } from "../types/ast.type";

export class FunctionStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public fnExpr: FunctionLiteralExpression;
  public name: string;
  public exported: boolean;
  public receiverType: string | null;

  constructor(
    token: Token,
    fnExpr: FunctionLiteralExpression,
    name: string,
    exported = false,
    receiverType: string | null = null,
  ) {
    this.token = token;
    this.fnExpr = fnExpr;
    this.name = name;
    this.exported = exported;
    this.receiverType = receiverType;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    return this.fnExpr.toString(tab_level);
  }
}
