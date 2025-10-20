import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { FunctionLiteralExpression } from "../expressions/FunctionLiteralExpression";
import { Identifier } from "../expressions/Identifier";
import { ASTStatement } from "../types/ast.type";

export class FunctionStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public identifier: Identifier | null;
  public fnExpr: FunctionLiteralExpression;

  constructor(token: Token, identifier: Identifier | null, fnExpr: FunctionLiteralExpression) {
    this.token = token;
    this.identifier = identifier;
    this.fnExpr = fnExpr;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    return this.fnExpr.toString(tab_level);
  }
}
