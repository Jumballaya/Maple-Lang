import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { ASTStatement } from "../types/ast.type";

export type ParsedStructMember = {
  name: string;
  type: string;
};

export class StructStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;

  public name: string;
  public members: Record<string, ParsedStructMember>;
  public exported: boolean;

  constructor(
    token: Token,
    name: string,
    members: Record<string, ParsedStructMember>,
    exported = false,
  ) {
    this.token = token;
    this.name = name;
    this.members = members;
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
