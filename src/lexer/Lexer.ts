import type { Token } from "./token.types.js";

export class Lexer {
  private text: string;
  private pointer = 0;
  private char = "";

  private line = 0;
  private col = 0;

  constructor(source: string) {
    this.text = source;
    this.readChar();
  }

  public getTokens(): Token[] {
    const tokens: Token[] = [];

    while (this.pointer < this.text.length) {
      this.pointer++;
      const token = this.nextToken();
      tokens.push(token);
      if (token.type === "EOF") {
        break;
      }
    }

    return tokens;
  }

  private peekChar(): string {
    return this.text[this.pointer + 1] ?? "\0";
  }

  private nextToken(): Token {
    throw new Error("Not implemented yet");
  }

  private readChar(): void {
    throw new Error("Not implemented yet");
  }

  private skipWhitespace(): void {
    throw new Error("Not implemented yet");
  }

  private readIdentifier(): string {
    throw new Error("Not implemented yet");
  }

  private readStringLiteral(): string {
    throw new Error("Not implemented yet");
  }

  private readCharLiteral(): string {
    throw new Error("Not implemented yet");
  }

  private readNumberLiteral(): number {
    throw new Error("Not implemented yet");
  }

  private readIntegerLiteral(): number {
    throw new Error("Not implemented yet");
  }

  private readFloatLiteral(): number {
    throw new Error("Not implemented yet");
  }
}
