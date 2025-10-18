import { Lexer } from "../lexer/Lexer";
import type { Token } from "../lexer/token.types";

export class Tokenizer {
  private tokens: Token[];
  private ptr = 0;
  private _curToken: Token;
  private _peekToken: Token;

  constructor(source: string) {
    const lexer = new Lexer(source);
    this.tokens = lexer.getTokens();
    this._curToken = this.tokens[0]!;
    this._peekToken = this.tokens[1]! ?? this.tokens[0]!;
  }

  public nextToken(): Token {
    const tok = this._curToken;
    if (!tok) {
      return this.tokens[this.tokens.length - 1]!;
    }
    this.ptr++;
    if (this.ptr >= this.tokens.length) {
      this.ptr = this.tokens.length - 1;
    }
    this._curToken = this.tokens[this.ptr]!;
    this._peekToken = this.tokens[this.ptr + 1]! ?? this.tokens[this.ptr]!;
    return tok;
  }

  public curToken(): Token {
    return this._curToken;
  }

  public peekToken(): Token {
    return this._peekToken;
  }
}
