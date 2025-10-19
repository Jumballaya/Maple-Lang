import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression, ASTStatement } from "../types/ast.type";
import { BlockStatement } from "./BlockStatement";

export class WhileStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public condExpr: ASTExpression;
  public loopBody: BlockStatement;

  constructor(token: Token, condExpr: ASTExpression, loopBody: BlockStatement) {
    this.token = token;
    this.condExpr = condExpr;
    this.loopBody = loopBody;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    let out = `${"\t".repeat(
      tab_level
    )}while (${this.condExpr.toString()}) {\n`;
    tab_level++;
    out += this.loopBody.toString(tab_level);
    tab_level--;
    out += "}";
    return out;
  }
}
