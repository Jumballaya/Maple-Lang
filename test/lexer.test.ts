import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../src/lexer/Lexer";

describe("Lexer", () => {
  test("can accept source text", () => {
    const src = "let x: i32 = 1 + 1;";
    assert.doesNotThrow(() => {
      const lexer = new Lexer(src);
    });
  });
  test("can lex integers", () => {
    const sources = ["0", "123", "0xFF", "0Xff", "0b1010", "0B1010"];
    for (const source of sources) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(tokens[0].type, "IntegerLiteral");
    }
  });
  test("can lex floats", () => {
    const sources = ["1.0", ".5", "0.25", "3.14e-2", "2E10", "123."];
    for (const source of sources) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(tokens[0].type, "FloatLiteral");
    }
  });
  test("can lex strings", () => {
    const sources = [
      `"Hello"`,
      `""`, // empty
      `"hi\\n"`, // escaped newline
      `"quote: \\""`, // escaped double quote
      `"backslash: \\\\"`, // escaped backslash
      `"hex A: \\x41"`, // \xNN
    ];
    for (const source of sources) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(tokens[0].type, "StringLiteral");
    }
  });
  test("can lex chars", () => {
    const sources = [
      `'a'`,
      `'\\n'`,
      `'\\t'`,
      `'\\x41'`, // 'A'
      `'\\''`, // single quote char
      `'\\\\'`, // backslash char
    ];
    for (const source of sources) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(tokens[0].type, "CharLiteral");
    }
  });
  test("can lex identifiers", () => {
    const sources = [
      `x`,
      `_x`,
      `_value123`,
      `foo_bar`,
      `Vec2`,
      `x1`,
      `fn1`,
      `leta`,
      `const4`,
    ];
    for (const source of sources) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(tokens[0].type, "Identifier");
    }
  });
  test("identifiers cannot start with digit", () => {
    const lexer = new Lexer("1abc");
    const tokens = lexer.getTokens();
    assert.equal(tokens[0].type, "IntegerLiteral");
    assert.equal(tokens[1].type, "Identifier");
  });
});

// Errors while lexing
describe("Lexer Error States", () => {
  test("unterminated string -> error token", () => {
    const lexer = new Lexer('"oops');
    assert.throws(() => {
      lexer.getTokens();
    });
  });
  test("unterminated char -> error token", () => {
    const lexer = new Lexer("'a");
    assert.throws(() => {
      lexer.getTokens();
    });
  });
  test("empty char literal -> error token", () => {
    const lexer = new Lexer("''");
    assert.throws(() => {
      lexer.getTokens();
    });
  });
});

// Individual Tokens
describe("Lexer Tokens", () => {
  test("Literals", () => {
    const tests: Array<[string, string]> = [
      ["12345", "IntegerLiteral"],
      ["3.1415926", "FloatLiteral"],
      [`'a'`, "CharLiteral"],
      [`"Hello!"`, "StringLiteral"],
    ];
    for (const [source, expected] of tests) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(tokens[0].type, expected);
    }
  });
  test("Keywords", () => {
    const tests: Array<[string, string]> = [
      ["fn", "Func"],
      ["return", "Return"],
      ["i8", "i8"],
      ["u8", "u8"],
      ["i16", "i16"],
      ["u16", "u16"],
      ["i32", "i32"],
      ["u32", "u32"],
      ["i64", "i64"],
      ["u64", "u64"],
      ["f32", "f32"],
      ["f64", "f64"],
      ["if", "If"],
      ["else", "Else"],
      ["for", "For"],
      ["while", "While"],
      ["break", "Break"],
      ["continue", "Continue"],
      ["switch", "Switch"],
      ["case", "Case"],
      ["default", "Default"],
      ["let", "Let"],
      ["const", "Const"],
      ["struct", "Struct"],
      ["as", "As"],
      ["true", "True"],
      ["false", "False"],
      ["bool", "Boolean"],
    ];
    for (const [source, expected] of tests) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(
        tokens[0].type,
        expected,
        `Type: ${tokens[0].type}, Expected: ${expected}`
      );
    }
  });
  test("Operators", () => {
    const tests: Array<[string, string]> = [
      ["*", "Star"],
      ["+", "Plus"],
      ["-", "Minus"],
      ["/", "Slash"],
      ["%", "Percent"],
      ["<", "LessThan"],
      [">", "GreaterThan"],
      ["&", "Ampersand"],
      ["^", "Caret"],
      ["|", "Pipe"],
      ["~", "Tilde"],
    ];
    for (const [source, expected] of tests) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(tokens[0].type, expected);
    }
  });
  test("Logical Operators", () => {
    const tests: Array<[string, string]> = [
      ["&&", "LogicalAnd"],
      ["||", "LogicalOr"],
      ["!", "Bang"],
      ["!=", "NotEquals"],
      ["<=", "LessThanEquals"],
      [">=", "GreaterThanEquals"],
      ["==", "Equals"],
    ];
    for (const [source, expected] of tests) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(tokens[0].type, expected);
    }
  });
  test("Bitwise", () => {
    const tests: Array<[string, string]> = [
      ["<<", "LeftShift"],
      [">>", "RightShift"],
    ];
    for (const [source, expected] of tests) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(tokens[0].type, expected);
    }
  });
  test("Assignment", () => {
    const tests: Array<[string, string]> = [
      ["=", "Assign"],
      ["+=", "AddAssign"],
      ["-=", "MinusAssign"],
      ["*=", "MulAssign"],
      ["/=", "DivAssign"],
      ["%=", "ModuloAssign"],
      ["<<=", "LeftShiftAssign"],
      [">>=", "RightShiftAssign"],
      ["&=", "BitwiseAndAssign"],
      ["^=", "BitwiseXorAssign"],
      ["|=", "BitwiseOrAssign"],
    ];
    for (const [source, expected] of tests) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(tokens[0].type, expected);
    }
  });
  test("Struct Member Access", () => {
    const tests: Array<[string, string]> = [
      ["->", "Arrow"],
      [".", "Period"],
    ];
    for (const [source, expected] of tests) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(tokens[0].type, expected);
    }
  });
  test("Punctuation", () => {
    const tests: Array<[string, string]> = [
      ["(", "LParen"],
      [")", "RParen"],
      ["[", "LBracket"],
      ["]", "RBracket"],
      ["{", "LBrace"],
      ["}", "RBrace"],
      [",", "Comma"],
      [":", "Colon"],
      [";", "Semicolon"],
      ["?", "Question"],
    ];
    for (const [source, expected] of tests) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(tokens[0].type, expected);
    }
  });
  test("Inc/Dec", () => {
    const tests: Array<[string, string]> = [
      ["++", "Increment"],
      ["--", "Decrement"],
    ];
    for (const [source, expected] of tests) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(tokens[0].type, expected);
    }
  });
  test("Other", () => {
    const tests: Array<[string, string]> = [
      ["null", "Null"],
      ["", "EOF"],
    ];
    for (const [source, expected] of tests) {
      const lexer = new Lexer(source);
      const tokens = lexer.getTokens();
      assert.equal(tokens[0].type, expected);
    }
  });
});
