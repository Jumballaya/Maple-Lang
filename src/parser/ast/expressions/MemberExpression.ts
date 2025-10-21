import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class MemberExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public parent: ASTExpression;
  public member: string;

  constructor(token: Token, parent: ASTExpression, member: string) {
    this.token = token;
    this.parent = parent;
    this.member = member;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    return `${this.parent.toString()}.${this.member}`;
  }
}
