import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { BlockStatement } from "../statements/BlockStatement";
import { ASTExpression } from "../types/ast.type";
import { Identifier } from "./Identifier";

export type FunctionParam = {
  identifier: Identifier;
  type: string;
};

export class FunctionLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public params: FunctionParam[];
  public body: BlockStatement;
  public returnType: string | null;

  constructor(
    token: Token,
    params: FunctionParam[],
    body: BlockStatement,
    returnType: string | null
  ) {
    this.token = token;
    this.params = params;
    this.body = body;
    this.returnType = returnType;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    const params = this.params
      .map((p) => `${p.identifier.toString()}: ${p.type}`)
      .join(", ");
    const lit = this.tokenLiteral();
    return `${"\t".repeat(tab_level)}${lit}(${params}) {\n${this.body.toString(
      tab_level + 1
    )}}`;
  }
}
