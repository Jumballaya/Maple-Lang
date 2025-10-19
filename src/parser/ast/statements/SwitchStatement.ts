import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression, ASTStatement } from "../types/ast.type";
import { BlockStatement } from "./BlockStatement";

export class SwitchStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public switchExpr: ASTExpression;
  public cases: Array<{ test: number; body: BlockStatement }>;
  public default?: BlockStatement;

  constructor(
    token: Token,
    switchExpr: ASTExpression,
    cases: Array<{ test: number; body: BlockStatement }>,
    def?: BlockStatement
  ) {
    this.token = token;
    this.switchExpr = switchExpr;
    this.cases = cases;
    if (def) {
      this.default = def;
    }
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    let out = "";
    return out;
  }
}
