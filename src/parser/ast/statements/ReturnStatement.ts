import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression, ASTStatement } from "../types/ast.type";

export class ReturnStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public returnValue: ASTExpression | null = null;

  constructor(token: Token, returnValue: ASTExpression | null = null) {
    this.token = token;
    this.returnValue = returnValue;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    let out = "return";
    if (this.returnValue !== null) {
      out += ` ${this.returnValue.toString()}`;
    }
    out += ";";
    return out;
  }
}
