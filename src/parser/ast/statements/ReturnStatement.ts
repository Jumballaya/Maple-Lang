import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { ASTExpression, ASTStatement } from "../types/ast.type";

export class ReturnStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public returnValues: ASTExpression[];

  constructor(token: Token, returnValues: ASTExpression[] | ASTExpression | null = null) {
    this.token = token;
    if (Array.isArray(returnValues)) {
      this.returnValues = returnValues;
    } else if (returnValues === null) {
      this.returnValues = [];
    } else {
      this.returnValues = [returnValues];
    }
  }

  /**
   * @deprecated Use returnValues instead.
   */
  public get returnValue(): ASTExpression | null {
    return this.returnValues[0] ?? null;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    if (this.returnValues.length === 0) return "return;";
    return `return ${this.returnValues.map((v) => v.toString()).join(", ")};`;
  }
}
