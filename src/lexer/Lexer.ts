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

      // Must be last, before the default clause
      // If some other token needs to take this spot
      // move both checks into the default clause
      case ".": {
        if (!isDigit(this.peekChar())) {
          const tok: Token = {
            ...mark,
            type: "Period",
            literal: ".",
          };
          this.readChar();
          return tok;
        }
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
      if (this.char !== keyword[0]) continue;
      if (!this.testValue(keyword)) continue;

      const next = this.text[this.pos + keyword.length] ?? "\0";
      if (!this.isIdentContinue(next)) {
        this.consumeValue(keyword);
        return {
          ...mark,
          type,
          literal: keyword,
        } as Token;
      }
    }
    for (const [keyword, type] of TYPE_KEYWORDS) {
      if (this.char !== keyword[0]) continue;
      if (!this.testValue(keyword)) continue;

      const next = this.text[this.pos + keyword.length] ?? "\0";
      if (!this.isIdentContinue(next)) {
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
    if (!this.isIdentStart(this.char)) return undefined;
    const start = this.pos;

    if (this.isIdentContinue(this.char)) {
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
    if (this.char !== '"') return undefined;
    this.readChar(); // consume opening "

    const bytes: number[] = [];
    const push = (code: number) => {
      bytes.push(code & 0xff);
    };

    // naive UTF-8 encoder for BMP code points (sufficient for MVP); upgrade later if needed
    const pushUtf8 = (ch: string) => {
      const code = ch.codePointAt(0)!;
      if (code <= 0x7f) {
        push(code);
      } else if (code <= 0x7ff) {
        push(0xc0 | (code >> 6));
        push(0x80 | (code & 0x3f));
      } else {
        push(0xe0 | (code >> 12));
        push(0x80 | ((code >> 6) & 0x3f));
        push(0x80 | (code & 0x3f));
      }
    };

    while (!this.isEOF() && this.char !== '"') {
      if (this.char === "\\") {
        this.readChar(); // at escape code
        switch (this.char) {
          case "n":
            this.readChar();
            push(0x0a);
            break;
          case "r":
            this.readChar();
            push(0x0d);
            break;
          case "t":
            this.readChar();
            push(0x09);
            break;
          case "0":
            this.readChar();
            push(0x00);
            break;
          case '"':
            this.readChar();
            push(0x22);
            break;
          case "'":
            this.readChar();
            push(0x27);
            break;
          case "\\":
            this.readChar();
            push(0x5c);
            break;
          case "x": {
            // \xNN — exactly 2 hex digits
            const h1 = this.peekChar();
            this.readChar();
            const h2 = this.peekChar();
            this.readChar();
            const v1 = this.hexVal(h1),
              v2 = this.hexVal(h2);
            if (v1 < 0 || v2 < 0)
              throw new Error("Invalid \\x escape (need two hex digits)");
            push((v1 << 4) | v2);
            break;
          }
          default: {
            // Unknown escape: take literally (or throw)
            const unk = this.char;
            this.readChar();
            pushUtf8(unk);
          }
        }
      } else {
        // normal char
        pushUtf8(this.char);
        this.readChar();
      }
    }

    if (this.char !== '"') {
      throw new Error(
        `String not terminated: ${this.text.slice(start, this.pos)}`
      );
    }
    this.readChar(); // consume closing "

    return {
      ...mark,
      type: "StringLiteral",
      literal: new Uint8Array(bytes),
    };
  }

  private parseCharLiteral(mark: Pos, start: number): Token | undefined {
    if (this.char !== "'") return undefined;
    this.readChar(); // consume opening '

    let code: number;

    if ((this.char as string) === "\\") {
      this.readChar(); // at escape code
      switch (this.char as string) {
        case "n":
          this.readChar();
          code = 0x0a;
          break;
        case "r":
          this.readChar();
          code = 0x0d;
          break;
        case "t":
          this.readChar();
          code = 0x09;
          break;
        case "0":
          this.readChar();
          code = 0x00;
          break;
        case '"':
          this.readChar();
          code = 0x22;
          break;
        case "'":
          this.readChar();
          code = 0x27;
          break;
        case "\\":
          this.readChar();
          code = 0x5c;
          break;
        case "x": {
          // Allow 1–2 digits for chars: '\x4' == 0x04, '\x41' == 0x41
          // We are currently on 'x'; consume hex after it:
          const v = this.readHexDigits(1, 2);
          this.readChar();
          code = v & 0xff;
          break;
        }
        default: {
          // Unknown escape: take literally (or throw)
          code = (this.char as string).charCodeAt(0) & 0xff;
          this.readChar();
        }
      }
    } else {
      if (this.char === "'" || this.char === "\0") {
        throw new Error("Char literal cannot be empty");
      }
      code = (this.char as string).charCodeAt(0) & 0xff;
      this.readChar();
    }

    if (this.char !== "'") {
      throw new Error(
        `Char not terminated: ${this.text.slice(start, this.pos)}`
      );
    }
    this.readChar(); // consume closing '

    return { ...mark, type: "CharLiteral", literal: code };
  }

  private parseNumberLiteral(mark: Pos, start: number): Token | undefined {
    // Fast reject: if current char isn't a digit nor a dot followed by digit, bail.
    if (
      !isDigit(this.char) &&
      !(this.char === "." && isDigit(this.peekChar()))
    ) {
      return undefined;
    }

    const begin = this.pos;

    // Hex or binary prefixes (when starting with '0x' / '0b')
    if (this.char === "0") {
      const p = this.peekChar();
      if (p === "x" || p === "X") {
        // consume '0x'
        this.readChar(); // now on 'x'/'X'
        this.readChar(); // move to first hex digit
        const digitsStart = this.pos;
        while (this.isHex(this.char)) this.readChar();
        const digits = this.text.slice(digitsStart, this.pos);
        if (digits.length === 0)
          throw new Error("Malformed hex literal: missing digits");
        const lexeme = this.text.slice(begin, this.pos);
        const value = Number.parseInt(digits, 16);
        return { ...mark, type: "IntegerLiteral", literal: value };
      }
      if (p === "b" || p === "B") {
        // consume '0b'
        this.readChar();
        this.readChar();
        const digitsStart = this.pos;
        while (this.isBin(this.char)) this.readChar();
        const digits = this.text.slice(digitsStart, this.pos);
        if (digits.length === 0)
          throw new Error("Malformed binary literal: missing digits");
        const value = Number.parseInt(digits, 2);
        return { ...mark, type: "IntegerLiteral", literal: value };
      }
    }

    // Decimal / Float
    // Accept:
    //   [digits][.digits][exp]
    //   .digits[exp]
    // where exp = (e|E)(+|-)?digits
    let sawDot = false;
    let sawExp = false;

    // digits before dot (if starting with '.' we skip this)
    if (isDigit(this.char)) {
      while (isDigit(this.char)) this.readChar();
    }

    // fraction
    if (this.char === ".") {
      sawDot = true;
      this.readChar(); // consume '.'
      if (!isDigit(this.char)) {
        // lone '.' after digits is not a number here (but you reached because first char was digit)
        // We allow "123." as float form (C allows). If you don’t want it, check and error.
      } else {
        while (isDigit(this.char)) this.readChar();
      }
    } else if (!isDigit(this.text[begin] ?? "\0")) {
      // started with '.' then digits: we already handled digits above
      // (when entry was '.' followed by digit)
    }

    // exponent
    if (this.char === "e" || this.char === "E") {
      sawExp = true;
      this.readChar(); // consume 'e'
      if ((this.char as string) === "+" || (this.char as string) === "-")
        this.readChar();
      if (!isDigit(this.char))
        throw new Error("Malformed float exponent: missing digits");
      while (isDigit(this.char)) this.readChar();
    }

    const end = this.pos;
    const lexeme = this.text.slice(begin, end);

    if (sawDot || sawExp || lexeme.startsWith(".")) {
      const num = Number.parseFloat(lexeme);
      if (Number.isNaN(num)) throw new Error(`Malformed float: ${lexeme}`);
      return { ...mark, type: "FloatLiteral", literal: num };
    } else {
      const num = Number.parseInt(lexeme, 10);
      if (Number.isNaN(num)) throw new Error(`Malformed integer: ${lexeme}`);
      return { ...mark, type: "IntegerLiteral", literal: num };
    }
  }

  // Helpers

  private isHex(c: string): boolean {
    return (
      (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F")
    );
  }
  private isBin(c: string): boolean {
    return c === "0" || c === "1";
  }
  private isIdentStart(c: string): boolean {
    return isLetter(c) || c === "_";
  }
  private isIdentContinue(c: string): boolean {
    return isLetter(c) || isDigit(c) || c === "_";
  }
  private isEOF(): boolean {
    return this.char === "\0";
  }

  private hexVal(c: string): number {
    if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
    if (c >= "a" && c <= "f") return 10 + c.charCodeAt(0) - 97;
    if (c >= "A" && c <= "F") return 10 + c.charCodeAt(0) - 65;
    return -1;
  }

  private readHexDigits(min: number, max: number): number {
    // Read between `min` and `max` hex digits, returning the accumulated value.
    // Uses this.peekChar()/this.readChar() against your current cursor.
    let read = 0;
    let value = 0;
    while (read < max) {
      const p = this.peekChar();
      const v = this.hexVal(p);
      if (v < 0) break;
      this.readChar(); // advance to include this digit
      value = (value << 4) | v;
      read++;
    }
    if (read < min) {
      throw new Error(`Invalid hex escape: expected ${min} hex digit(s)`);
    }
    return value;
  }
}
