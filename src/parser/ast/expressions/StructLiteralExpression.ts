import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { StructMember } from "../statements/StructStatement";
import { ASTExpression } from "../types/ast.type";

export type StructTable = {
  size: number;
  members: Record<string, StructMember>;
};

export class StructLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public name: string;
  public members: Record<string, ASTExpression>;
  public location = 0;

  constructor(
    token: Token,
    name: string,
    members: Record<string, ASTExpression>
  ) {
    this.token = token;
    this.name = name;
    this.members = members;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    const members = Object.entries(this.members).map(
      ([name, entry]) => `${name} = ${entry.toString()}`
    );
    return `struct ${this.name} {\n${members.join(",\n")}\n}`;
  }
}
