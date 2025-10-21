import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

export class BooleanLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public func: string;
  public args: ASTExpression[];

  constructor(token: Token, func: string, args: ASTExpression[]) {
    this.token = token;
    this.func = func;
    this.args = args;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    return `${this.func}(${this.args.map((a) => a.toString()).join(", ")})`;
  }
}
