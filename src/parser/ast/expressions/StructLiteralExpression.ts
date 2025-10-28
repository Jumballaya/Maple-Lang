import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { StructMember } from "../statements/StructStatement";
import { ASTExpression } from "../types/ast.type";

type StructTable = {
  size: number;
  members: Record<string, StructMember>;
};

export class StructLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public name: string;
  public table: StructTable;
  public location = 0;

  constructor(
    token: Token,
    name: string,
    table: StructTable
  ) {
    this.token = token;
    this.name = name;
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
