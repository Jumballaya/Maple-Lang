import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { ASTStatement } from "../types/ast.type";

export class ContinueStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;

  constructor(token: Token) {
    this.token = token;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(_tab_level = 0): string {
    return "continue";
  }
}
