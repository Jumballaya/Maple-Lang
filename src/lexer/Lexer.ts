import { KEYWORDS, TYPE_KEYWORDS } from "./lexer.constants.js";
import { isDigit, isLetter } from "./lexer.utils.js";
import type { Pos, Token } from "./token.types.js";

export class Lexer {
  private text: string;
  private pos = -1;
  private readPos = 0;
  private char = "";

  private line = 1;
  private col = 1;

  constructor(source: string) {
    this.text = source;
    this.readChar();
  }

  public getTokens(): Token[] {
    const tokens: Token[] = [];

    while (this.pos <= this.text.length) {
      const token = this.nextToken();
      tokens.push(token);
      if (token.type === "EOF") {
        break;
      }
    }

    return tokens;
  }

  private peekChar(): string {
    return this.readPos < this.text.length
      ? this.text.charAt(this.readPos)
      : "\0";
  }

  private nextToken(): Token {
    this.skipWhitespace();
    const mark = this.mark();
    switch (this.char) {
      case "\0": {
        return {
          ...mark,
          type: "EOF",
          literal: "\0",
        };
      }
      case "*": {
        if (this.peekChar() === "=") {
          const tok: Token = {
            ...mark,
            type: "MulAssign",
            literal: "*=",
          };
          this.readChar();
          this.readChar();
          return tok;
        }
        const tok: Token = {
          ...mark,
          type: "Star",
          literal: "*",
        };
        this.readChar();
        return tok;
      }
      case "+": {
        if (this.peekChar() === "=") {
          const tok: Token = {
            ...mark,
            type: "AddAssign",
            literal: "+=",
          };
          this.readChar();
          this.readChar();
          return tok;
        }
        if (this.peekChar() === "+") {
          const tok: Token = {
            ...mark,
            type: "Increment",
            literal: "++",
          };
          this.readChar();
          this.readChar();
          return tok;
        }
        const tok: Token = {
          ...mark,
          type: "Plus",
          literal: "+",
        };
        this.readChar();
        return tok;
      }
      case "-": {
        if (this.peekChar() === ">") {
          const tok: Token = {
            ...mark,
            type: "Arrow",
            literal: "->",
          };
          this.readChar();
          this.readChar();
          return tok;
        }
        if (this.peekChar() === "=") {
          const tok: Token = {
            ...mark,
            type: "MinusAssign",
            literal: "-=",
          };
          this.readChar();
          this.readChar();
          return tok;
        }
        if (this.peekChar() === "-") {
          const tok: Token = {
            ...mark,
            type: "Decrement",
            literal: "--",
          };
          this.readChar();
          this.readChar();
          return tok;
        }
        const tok: Token = {
          ...mark,
          type: "Minus",
          literal: "-",
        };
        this.readChar();
        return tok;
      }
      case "/": {
        if (this.peekChar() === "=") {
          const tok: Token = {
            ...mark,
            type: "DivAssign",
            literal: "/=",
          };
          this.readChar();
          this.readChar();
          return tok;
        }
        const tok: Token = {
          ...mark,
          type: "Slash",
          literal: "/",
        };
        this.readChar();
        return tok;
      }
      case "%": {
        if (this.peekChar() === "=") {
          const tok: Token = {
            ...mark,
            type: "ModuloAssign",
            literal: "%=",
          };
          this.readChar();
          this.readChar();
          return tok;
        }
        const tok: Token = {
          ...mark,
          type: "Percent",
          literal: "%",
        };
        this.readChar();
        return tok;
      }
      case "<": {
        if (this.peekChar() === "<") {
          this.readChar();
          if (this.peekChar() === "=") {
            this.readChar();
            const tok: Token = {
              ...mark,
              type: "LeftShiftAssign",
              literal: "<<=",
            };
            this.readChar();
            return tok;
          }
          const tok: Token = {
            ...mark,
            type: "LeftShift",
            literal: "<<",
          };
          this.readChar();
          return tok;
        }
        if (this.peekChar() === "=") {
          this.readChar();
          const tok: Token = {
            ...mark,
            type: "LessThanEquals",
            literal: "<=",
          };
          this.readChar();
          return tok;
        }
        const tok: Token = {
          ...mark,
          type: "LessThan",
          literal: "<",
        };
        this.readChar();
        return tok;
      }
      case ">": {
        if (this.peekChar() === ">") {
          this.readChar();
          if (this.peekChar() === "=") {
            this.readChar();
            const tok: Token = {
              ...mark,
              type: "RightShiftAssign",
              literal: ">>=",
            };
            this.readChar();
            return tok;
          }
          const tok: Token = {
            ...mark,
            type: "RightShift",
            literal: ">>",
          };
          this.readChar();
          return tok;
        }
        if (this.peekChar() === "=") {
          this.readChar();
          const tok: Token = {
            ...mark,
            type: "GreaterThanEquals",
            literal: ">=",
          };
          this.readChar();
          return tok;
        }
        const tok: Token = {
          ...mark,
          type: "GreaterThan",
          literal: ">",
        };
        this.readChar();
        return tok;
      }
      case "&": {
        if (this.peekChar() === "=") {
          this.readChar();
          const tok: Token = {
            ...mark,
            type: "BitwiseAndAssign",
            literal: "&=",
          };
          this.readChar();
          return tok;
        }
        if (this.peekChar() === "&") {
          const tok: Token = {
            ...mark,
            type: "LogicalAnd",
            literal: "&&",
          };
          this.readChar();
          this.readChar();
          return tok;
        }
        const tok: Token = {
          ...mark,
          type: "Ampersand",
          literal: "&",
        };
        this.readChar();
        return tok;
      }
      case "^": {
        if (this.peekChar() === "=") {
          this.readChar();
          const tok: Token = {
            ...mark,
            type: "BitwiseXorAssign",
            literal: "^=",
          };
          this.readChar();
          return tok;
        }
        const tok: Token = {
          ...mark,
          type: "Caret",
          literal: "^",
        };
        this.readChar();
        return tok;
      }
      case "|": {
        if (this.peekChar() === "=") {
          this.readChar();
          const tok: Token = {
            ...mark,
            type: "BitwiseOrAssign",
            literal: "|=",
          };
          this.readChar();
          return tok;
        }
        if (this.peekChar() === "|") {
          const tok: Token = {
            ...mark,
            type: "LogicalOr",
            literal: "||",
          };
          this.readChar();
          this.readChar();
          return tok;
        }
        const tok: Token = {
          ...mark,
          type: "Pipe",
          literal: "|",
        };
        this.readChar();
        return tok;
      }
      case "~": {
        const tok: Token = {
          ...mark,
          type: "Tilde",
          literal: "~",
        };
        this.readChar();
        return tok;
      }
      case "!": {
        if (this.peekChar() === "=") {
          const tok: Token = {
            ...mark,
            type: "NotEquals",
            literal: "!=",
          };
          this.readChar();
          this.readChar();
          return tok;
        }
        const tok: Token = {
          ...mark,
          type: "Bang",
          literal: "!",
        };
        this.readChar();
        return tok;
      }
      case "=": {
        if (this.peekChar() === "=") {
          const tok: Token = {
            ...mark,
            type: "Equals",
            literal: "==",
          };
          this.readChar();
          this.readChar();
          return tok;
        }
        const tok: Token = {
          ...mark,
          type: "Assign",
          literal: "=",
        };
        this.readChar();
        return tok;
      }
      case ".": {
        const tok: Token = {
          ...mark,
          type: "Period",
          literal: ".",
        };
        this.readChar();
        return tok;
      }
      case "(": {
        const tok: Token = {
          ...mark,
          type: "LParen",
          literal: "(",
        };
        this.readChar();
        return tok;
      }
      case ")": {
        const tok: Token = {
          ...mark,
          type: "RParen",
          literal: ")",
        };
        this.readChar();
        return tok;
      }
      case "[": {
        const tok: Token = {
          ...mark,
          type: "LBracket",
          literal: "[",
        };
        this.readChar();
        return tok;
      }
      case "]": {
        const tok: Token = {
          ...mark,
          type: "RBracket",
          literal: "]",
        };
        this.readChar();
        return tok;
      }
      case "{": {
        const tok: Token = {
          ...mark,
          type: "LBrace",
          literal: "{",
        };
        this.readChar();
        return tok;
      }
      case "}": {
        const tok: Token = {
          ...mark,
          type: "RBrace",
          literal: "}",
        };
        this.readChar();
        return tok;
      }
      case ",": {
        const tok: Token = {
          ...mark,
          type: "Comma",
          literal: ",",
        };
        this.readChar();
        return tok;
      }
      case ":": {
        const tok: Token = {
          ...mark,
          type: "Colon",
          literal: ":",
        };
        this.readChar();
        return tok;
      }
      case ";": {
        const tok: Token = {
          ...mark,
          type: "Semicolon",
          literal: ";",
        };
        this.readChar();
        return tok;
      }
      case "?": {
        const tok: Token = {
          ...mark,
          type: "Question",
          literal: "?",
        };
        this.readChar();
        return tok;
      }

      default: {
        // run function to test against all keywords instead of having them as cases
        const keywordToken = this.parseKeyword(mark);
        if (keywordToken) {
          return keywordToken;
        }
        // then check for int literal, float literal, string literal and char literals
        const literalToken = this.parseLiteral(mark);
        if (literalToken) {
          return literalToken;
        }
        // then check for identifiers
        const identToken = this.parseIdentifier(mark);
        if (identToken) {
          return identToken;
        }
      }
    }

    throw new Error(`Error: undefined symbol: ${this.char}`);
  }

  private readChar(): void {
    if (this.readPos >= this.text.length) {
      this.char = "\0";
      this.pos = this.text.length;
      return;
    }

    const c = this.text.charAt(this.readPos);
    this.char = c;
    this.pos = this.readPos;
    this.readPos++;

    if (c === "\n") {
      this.line += 1;
      this.col = 0;
    } else {
      this.col += 1;
    }
  }

  private skipWhitespace(): void {
    while (true) {
      // whitespace
      while (
        this.char === " " ||
        this.char === "\t" ||
        this.char === "\n" ||
        this.char === "\r"
      ) {
        this.readChar();
      }

      // single-line comments
      if (this.char === "/" && this.peekChar() === "/") {
        let c = this.char;
        while (c !== "\n" && c !== "\0") {
          this.readChar();
          c = this.char;
        }
        continue;
      }
      break;
    }
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

  private mark(): Pos {
    return {
      start: this.pos,
      end: this.pos,
      line: this.line,
      col: this.col,
    };
  }

  private testValue(value: string): boolean {
    const len = value.length;
    const extracted = this.text.slice(this.pos, this.pos + len);
    return extracted === value;
  }

  private consumeValue(value: string) {
    const len = value.length;
    for (let i = 0; i < len; i++) {
      this.readChar();
    }
  }

  private parseKeyword(mark: Pos): Token | undefined {
    for (const [keyword, type] of KEYWORDS) {
      if (this.char !== keyword[0]) {
        continue;
      }
      if (this.testValue(keyword)) {
        const atEnd = this.pos + keyword.length >= this.text.length;
        const spaceAfter =
          this.text.slice(
            this.pos + keyword.length,
            this.pos + keyword.length + 1
          ) === " ";
        if (atEnd || spaceAfter) {
          // make sure the next char is a space or eof
          this.consumeValue(keyword);
          return {
            ...mark,
            type,
            literal: keyword,
          } as Token;
        }
      }
    }
    for (const [keyword, type] of TYPE_KEYWORDS) {
      if (this.char !== keyword[0]) {
        continue;
      }
      if (this.testValue(keyword)) {
        this.consumeValue(keyword);
        return {
          ...mark,
          type,
          literal: keyword,
        } as Token;
      }
    }
    return undefined;
  }

  private parseLiteral(mark: Pos): Token | undefined {
    const start = this.pos;

    // String literal
    if (this.char === '"') {
      return this.parseStringLiteral(mark, start);
    }

    // Char Literal
    if (this.char === "'") {
      return this.parseCharLiteral(mark, start);
    }

    // Numbers
    return this.parseNumberLiteral(mark, start);
  }

  private parseIdentifier(mark: Pos): Token | undefined {
    const start = this.pos;
    if (isLetter(this.char) || this.char === "_") {
      while (isLetter(this.char) || isDigit(this.char)) {
        this.readChar();
      }
      const end = this.pos;
      const ident = this.text.slice(start, end);
      return {
        ...mark,
        type: "Identifier",
        literal: ident,
      };
    }
    return undefined;
  }

  private parseStringLiteral(mark: Pos, start: number): Token | undefined {
    if (this.char !== '"') {
      return undefined;
    }
    this.readChar(); // read first quote
    while (this.char !== '"') {
      if (this.char === "\\") {
        // escape the next char
        this.readChar();
      }
      if (this.char === "\0") {
        throw new Error(
          `String not terminated: ${this.text.slice(start, this.pos)}`
        );
      }
      this.readChar();
    }
    this.readChar(); // read last quote
    const end = this.pos - 1; // -1 to remove quotes
    const literal = this.text.slice(start + 1, end); // +1 to remove quotes
    return {
      ...mark,
      type: "StringLiteral",
      literal: new TextEncoder().encode(literal),
    };
  }

  private parseCharLiteral(mark: Pos, start: number): Token | undefined {
    if (this.char !== "'") {
      return undefined;
    }
    this.readChar(); // read first quote
    while (this.char !== "'") {
      if (this.char === "\\") {
        // escape the next char
        this.readChar();
      }
      if (this.char === "\0") {
        throw new Error(
          `Char not terminated: ${this.text.slice(start, this.pos)}`
        );
      }
      this.readChar();
    }
    this.readChar(); // read last quote
    const end = this.pos - 1; // -1 to remove quotes
    const literal = this.text.slice(start + 1, end); // +1 to remove quotes
    if (literal.length === 0) {
      throw new Error("Char literals can not be empty");
    }
    return {
      ...mark,
      type: "CharLiteral",
      literal: literal.charCodeAt(0),
    };
  }

  private parseNumberLiteral(mark: Pos, start: number): Token | undefined {
    let type: "float" | "int" = "int";
    let nums: string[] = [];
    let seenPeriod = false;
    while (isDigit(this.char) || this.char === ".") {
      if (this.char === "\0") {
        break;
      }
      if (this.char === ".") {
        if (seenPeriod) {
          throw new Error(
            `malformed number: ${this.text.slice(start, this.pos + 4)}`
          );
        }
        seenPeriod = true;
        type = "float";
      }
      nums.push(this.char);
      this.readChar();
    }
    const num = nums.join("");
    const value = type === "float" ? parseFloat(num) : parseInt(num);

    if (isNaN(value)) {
      return undefined;
    }

    return {
      ...mark,
      type: type === "float" ? "FloatLiteral" : "IntegerLiteral",
      literal: value,
    };
  }
}
