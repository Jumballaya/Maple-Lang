import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression, ASTStatement } from "../types/ast.type";
import { BlockStatement } from "./BlockStatement";

export class IfStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public conditionExpr: ASTExpression;
  public thenBlock: BlockStatement;
  public elseBlock?: BlockStatement;

  constructor(
    token: Token,
    conditionExpr: ASTExpression,
    thenBlock: BlockStatement,
    elseBlock?: BlockStatement
  ) {
    this.token = token;
    this.conditionExpr = conditionExpr;
    this.thenBlock = thenBlock;

    if (elseBlock) {
      this.elseBlock = elseBlock;
    }
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    let out = `${"\t".repeat(tab_level)}if (`;
    out += this.conditionExpr.toString();
    out += ") {\n";
    tab_level++;
    out += this.thenBlock.toString(tab_level);
    out += "}";
    if (this.elseBlock) {
      out += "else {\n";
      tab_level++;
      out += this.elseBlock.toString(tab_level);
      tab_level--;
      out += "}";
    }
    out += "\n";

    return out;
  }
}
