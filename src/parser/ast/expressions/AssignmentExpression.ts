import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { ASTExpression } from "../types/ast.type";

export class AssignmentExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public left: ASTExpression;
  public operator: string;
  public value: ASTExpression | null = null;

  constructor(
    token: Token,
    left: ASTExpression,
    value: ASTExpression | null = null,
    operator = "=",
  ) {
    this.token = token;
    this.left = left;
    this.operator = operator;
    this.value = value;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    const { left, value, operator } = this;
    return `${left.toString()} ${operator} ${value?.toString() ?? ""}`;
  }
}
