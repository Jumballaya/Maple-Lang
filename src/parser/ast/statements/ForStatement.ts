import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { ASTStatement } from "../types/ast.type";
import type { BlockStatement } from "./BlockStatement";
import type { ExpressionStatement } from "./ExpressionStatement";
import type { LetStatement } from "./LetStatement";

export class ForStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public initBlock: LetStatement;
  public conditionExpr: ExpressionStatement;
  public updateExpr: ExpressionStatement;
  public loopBody: BlockStatement;

  constructor(
    token: Token,
    initBlock: LetStatement,
    conditionExpr: ExpressionStatement,
    updateExpr: ExpressionStatement,
    loopBody: BlockStatement,
  ) {
    this.token = token;
    this.initBlock = initBlock;
    this.conditionExpr = conditionExpr;
    this.updateExpr = updateExpr;
    this.loopBody = loopBody;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    const out = `for (${this.initBlock.toString()} ${this.conditionExpr.toString()} ${this.updateExpr.toString()}) {
${this.loopBody.toString(tab_level)}
    }
`;
    return out;
  }
}
