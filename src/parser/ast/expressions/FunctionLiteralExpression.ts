import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import { Token } from "../../../lexer/token.types";
import { BlockStatement } from "../statements/BlockStatement";
import { ASTExpression } from "../types/ast.type";
import { Identifier } from "./Identifier";

export type FunctionParameter = {
  identifier: Identifier;
  typeAnnotation: string;
};

export class FunctionLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public name: Identifier | null;
  public parameters: FunctionParameter[];
  public returnType: string | null;
  public body: BlockStatement;

  constructor(
    token: Token,
    {
      name = null,
      parameters = [],
      returnType = null,
      body = new BlockStatement(token),
    }: {
      name?: Identifier | null;
      parameters?: FunctionParameter[];
      returnType?: string | null;
      body?: BlockStatement;
    } = {}
  ) {
    this.token = token;
    this.name = name;
    this.parameters = parameters;
    this.returnType = returnType;
    this.body = body;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(tab_level = 0): string {
    const tabs = "\t".repeat(tab_level);
    const name = this.name ? ` ${this.name.toString()}` : "";
    const params = this.parameters
      .map((param) => `${param.identifier.toString()}: ${param.typeAnnotation}`)
      .join(", ");
    const returnType = this.returnType ? this.returnType : "void";
    const body = this.body.toString(tab_level + 1);
    const bodyBlock = body ? `\n${body}${tabs}` : "";
    return `${tabs}fn${name}(${params}): ${returnType} {${bodyBlock}}`;
  }
}
