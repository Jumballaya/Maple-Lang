import type { MinusToken, Pos, Token } from "./token.types.js";

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

      /// Keywords

      case "a": {
        if (this.testValue("as")) {
          this.consumeValue("as");
          return {
            ...mark,
            type: "As",
            literal: "as",
          };
        }
      }

      case "b": {
        if (this.testValue("bool")) {
          this.consumeValue("bool");
          return {
            ...mark,
            type: "Boolean",
            literal: "bool",
          };
        }
        if (this.testValue("break")) {
          this.consumeValue("break");
          return {
            ...mark,
            type: "Break",
            literal: "break",
          };
        }
      }

      case "c": {
        if (this.testValue("case")) {
          this.consumeValue("case");
          return {
            ...mark,
            type: "Case",
            literal: "case",
          };
        }
        if (this.testValue("const")) {
          this.consumeValue("const");
          return {
            ...mark,
            type: "Const",
            literal: "const",
          };
        }
        if (this.testValue("continue")) {
          this.consumeValue("continue");
          return {
            ...mark,
            type: "Continue",
            literal: "continue",
          };
        }
      }

      case "d": {
        if (this.testValue("default")) {
          this.consumeValue("default");
          return {
            ...mark,
            type: "Default",
            literal: "default",
          };
        }
      }

      case "e": {
        if (this.testValue("else")) {
          this.consumeValue("else");
          return {
            ...mark,
            type: "Else",
            literal: "else",
          };
        }
      }

      case "f": {
        if (this.testValue("fn")) {
          this.consumeValue("fn");
          return {
            ...mark,
            type: "Func",
            literal: "fn",
          };
        }
        if (this.testValue("f32")) {
          this.consumeValue("f32");
          return {
            ...mark,
            type: "f32",
            literal: "f32",
          };
        }
        if (this.testValue("f64")) {
          this.consumeValue("f64");
          return {
            ...mark,
            type: "f64",
            literal: "f64",
          };
        }
        if (this.testValue("for")) {
          this.consumeValue("for");
          return {
            ...mark,
            type: "For",
            literal: "for",
          };
        }
        if (this.testValue("false")) {
          this.consumeValue("false");
          return {
            ...mark,
            type: "False",
            literal: "false",
          };
        }
      }

      case "l": {
        if (this.testValue("let")) {
          this.consumeValue("let");
          return {
            ...mark,
            type: "Let",
            literal: "let",
          };
        }
      }

      case "n": {
        if (this.testValue("null")) {
          this.consumeValue("null");
          return {
            ...mark,
            type: "Null",
            literal: "null",
          };
        }
      }

      case "r": {
        if (this.testValue("return")) {
          this.consumeValue("return");
          return {
            ...mark,
            type: "Return",
            literal: "return",
          };
        }
      }

      case "s": {
        if (this.testValue("struct")) {
          this.consumeValue("struct");
          return {
            ...mark,
            type: "Struct",
            literal: "struct",
          };
        }
        if (this.testValue("switch")) {
          this.consumeValue("switch");
          return {
            ...mark,
            type: "Switch",
            literal: "switch",
          };
        }
      }

      case "t": {
        if (this.testValue("true")) {
          this.consumeValue("true");
          return {
            ...mark,
            type: "True",
            literal: "true",
          };
        }
      }

      case "w": {
        if (this.testValue("while")) {
          this.consumeValue("while");
          return {
            ...mark,
            type: "While",
            literal: "while",
          };
        }
      }

      case "i": {
        if (this.testValue("if")) {
          this.consumeValue("if");
          return {
            ...mark,
            type: "If",
            literal: "if",
          };
        }
        if (this.testValue("i8")) {
          this.consumeValue("i8");
          return {
            ...mark,
            type: "i8",
            literal: "i8",
          };
        }
        if (this.testValue("i16")) {
          this.consumeValue("i16");
          return {
            ...mark,
            type: "i16",
            literal: "i16",
          };
        }
        if (this.testValue("i32")) {
          this.consumeValue("i32");
          return {
            ...mark,
            type: "i32",
            literal: "i32",
          };
        }
        if (this.testValue("i64")) {
          this.consumeValue("i64");
          return {
            ...mark,
            type: "i64",
            literal: "i64",
          };
        }
      }

      case "u": {
        if (this.testValue("u8")) {
          this.consumeValue("u8");
          return {
            ...mark,
            type: "u8",
            literal: "u8",
          };
        }
        if (this.testValue("u16")) {
          this.consumeValue("u16");
          return {
            ...mark,
            type: "u16",
            literal: "u16",
          };
        }
        if (this.testValue("u32")) {
          this.consumeValue("u32");
          return {
            ...mark,
            type: "u32",
            literal: "u32",
          };
        }
        if (this.testValue("u64")) {
          this.consumeValue("u64");
          return {
            ...mark,
            type: "u64",
            literal: "u64",
          };
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
}
