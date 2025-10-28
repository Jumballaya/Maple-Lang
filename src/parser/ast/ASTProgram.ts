import type { ASTNode, ASTStatement } from "./types/ast.type";

export class ASTProgram {
  public type: ASTNode["type"];
  public statements: Array<ASTStatement> = [];
  public name: string;

  constructor(type: ASTNode["type"], name: string) {
    this.type = type;
    this.name = name;
  }

  public tokenLiteral(): string {
    const literal: string[] = [];
    const stmt = this.statements[0];
    if (stmt) {
      literal.push(stmt.tokenLiteral());
    }
    return literal.length ? literal.join("\n") : "";
  }

  public toString(): string {
    const literal: string[] = [];
    for (let i = 0; i < this.statements.length; i++) {
      const stmt = this.statements[i]!;
      literal.push(stmt.tokenLiteral());
    }
    return literal.length ? literal.join("\n") : "";
  }
}
