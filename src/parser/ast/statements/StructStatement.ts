import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTStatement } from "../types/ast.type";

export type StructMember = {
  name: string;
  type: string;
  offset: number;
  size: number;
};

export class StructStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;

  public name: string;
  public members: Record<string, StructMember>;
  public exported: boolean;
  public size: number;

  constructor(
    token: Token,
    name: string,
    members: Record<string, StructMember>,
    size: number,
    exported = false
  ) {
    this.token = token;
    this.name = name;
    this.members = members;
    this.size = size;
    this.exported = exported;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    let out = "{\n";
    tab_level++;
    for (const member of Object.values(this.members)) {
      out += `${"\t".repeat(tab_level)}${member.name}: ${member.type},\n`;
    }
    tab_level--;
    out += "}";
    return out;
  }
}
