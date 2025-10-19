import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTStatement } from "../types/ast.type";

export class BlockStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public statements: ASTStatement[];

  constructor(token: Token, statements: ASTStatement[] = []) {
    this.token = token;
    this.statements = statements;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    let out = "";
    for (const s of this.statements) {
      out += "\t".repeat(tab_level) + s.toString() + "\n";
    }
    return out;
  }
}
