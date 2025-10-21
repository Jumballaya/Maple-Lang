import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTExpression } from "../types/ast.type";

type StructTable = {
  size: number;
  members: Record<string, { type: string; offset: number; size: number }>;
};

export class StructLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public name: string;
  public structId: number;
  public table: StructTable;

  constructor(
    token: Token,
    name: string,
    structId: number,
    table: StructTable
  ) {
    this.token = token;
    this.name = name;
    this.structId = structId;
    this.table = table;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    const members = Object.entries(this.table.members).map(
      ([name, entry]) => `${name}: ${entry.type}`
    );
    return `struct ${this.name} {\n${members.join(",\n")}\n}`;
  }
}
