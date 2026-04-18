import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { BlockStatement } from "../statements/BlockStatement";
import type { ASTExpression } from "../types/ast.type";
import type { Identifier } from "./Identifier";

export type FunctionParam = {
  identifier: Identifier;
  type: string;
};

export class FunctionLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public params: FunctionParam[];
  public body: BlockStatement;
  public returnTypes: string[];

  constructor(
    token: Token,
    params: FunctionParam[],
    body: BlockStatement,
    returnTypes: string[] | string | null,
  ) {
    this.token = token;
    this.params = params;
    this.body = body;
    if (Array.isArray(returnTypes)) {
      this.returnTypes = returnTypes;
    } else if (returnTypes === null || returnTypes === "void") {
      this.returnTypes = [];
    } else {
      this.returnTypes = [returnTypes];
    }
  }

  /**
   * @deprecated Use returnTypes instead.
   */
  public get returnType(): string | null {
    return this.returnTypes[0] ?? null;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    const params = this.params.map((p) => `${p.identifier.toString()}: ${p.type}`).join(", ");
    const lit = this.tokenLiteral();
    const returnTypeLabel =
      this.returnTypes.length === 0
        ? "void"
        : this.returnTypes.length === 1
          ? this.returnTypes[0]
          : `(${this.returnTypes.join(", ")})`;
    return `${"\t".repeat(tab_level)}${lit}(${params}): ${
      returnTypeLabel
    } {\n${this.body.toString(tab_level + 1)}}`;
  }
}
