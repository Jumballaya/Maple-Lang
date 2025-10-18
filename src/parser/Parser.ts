import { Tokenizer } from "../lexer/Tokenizer";
import { ASTProgram } from "./ast/ASTProgram";

export class Parser {
  private tokenizer: Tokenizer;

  constructor(source: string) {
    this.tokenizer = new Tokenizer(source);
  }

  public parse(): ASTProgram {
    return new ASTProgram("statement");
  }
}
