import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Parser } from "../src/parser/Parser";
import { LetStatement } from "../src/parser/ast/statements/LetStatement";

describe("Parser", () => {
  test("can accept source text", () => {
    const src = "let x: i32 = 41 + 1;";
    assert.doesNotThrow(() => {
      const p = new Parser(src);
    });
  });

  const expectVariableStatement = (stmt: unknown): LetStatement => {
    assert.ok(stmt, "expected variable statement");
    const variableStmt = stmt as LetStatement;
    assert.equal(
      typeof variableStmt.tokenLiteral,
      "function",
      "variable statement must expose tokenLiteral"
    );
    assert.ok(variableStmt.identifier, "missing identifier on variable statement");
    assert.ok(
      variableStmt.identifier.token?.literal,
      "missing identifier token literal"
    );
    assert.equal(
      typeof variableStmt.typeAnnotation,
      "string",
      "missing type annotation"
    );
    return variableStmt;
  };

  test("parses empty program without statements", () => {
    const parser = new Parser("");
    const program = parser.parse();
    assert.ok(program, "parser did not return a program");
    assert.equal(program.statements.length, 0);
    assert.equal(program.tokenLiteral(), "");
  });

  test("parses single let statement without trailing whitespace", () => {
    const parser = new Parser("let answer: i32 = 42;");
    const program = parser.parse();

    assert.equal(program.statements.length, 1);
    const statement = expectVariableStatement(program.statements[0]);
    assert.equal(statement.tokenLiteral(), "let");
    assert.equal(statement.identifier.token.literal, "answer");
    assert.equal(statement.typeAnnotation, "i32");
    assert.ok(statement.expression, "let statement missing initializer");
    assert.equal(statement.expression?.tokenLiteral(), "42");
  });

  test("parses single const statement with trailing whitespace", () => {
    const parser = new Parser("const max: i32 = 100;   ");
    const program = parser.parse();

    assert.equal(program.statements.length, 1);
    const statement = expectVariableStatement(program.statements[0]);
    assert.equal(statement.tokenLiteral(), "const");
    assert.equal(statement.identifier.token.literal, "max");
    assert.equal(statement.typeAnnotation, "i32");
    assert.ok(statement.expression, "const statement missing initializer");
    assert.equal(statement.expression?.tokenLiteral(), "100");
  });

  test("parses multiple let and const statements", () => {
    const source = "let count: i32 = 1;\nconst next: i32 = count;";
    const parser = new Parser(source);
    const program = parser.parse();

    assert.equal(program.statements.length, 2);

    const first = expectVariableStatement(program.statements[0]);
    assert.equal(first.tokenLiteral(), "let");
    assert.equal(first.identifier.token.literal, "count");
    assert.equal(first.typeAnnotation, "i32");
    assert.equal(first.expression?.tokenLiteral(), "1");

    const second = expectVariableStatement(program.statements[1]);
    assert.equal(second.tokenLiteral(), "const");
    assert.equal(second.identifier.token.literal, "next");
    assert.equal(second.typeAnnotation, "i32");
    assert.equal(second.expression?.tokenLiteral(), "count");
  });
});
