import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { ASTStatement } from "../types/ast.type";

export class ImportStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public readonly imported: string[];
  public readonly importPath: string;

  constructor(token: Token, imported: string[], importPath: string) {
    this.token = token;
    this.imported = imported;
    this.importPath = importPath;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    return `import ${this.imported.join(", ")} from "${this.importPath}"`;
  }
}
