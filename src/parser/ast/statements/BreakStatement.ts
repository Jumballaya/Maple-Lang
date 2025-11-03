import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTStatement } from "../types/ast.type";

export class BreakStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;

  constructor(token: Token) {
    this.token = token;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    return "break";
  }
}
