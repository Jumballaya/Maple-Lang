import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Parser } from "../src/parser/Parser";
import { BlockStatement } from "../src/parser/ast/statements/BlockStatement";
import { ExpressionStatement } from "../src/parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../src/parser/ast/statements/ForStatement";
import { IfStatement } from "../src/parser/ast/statements/IfStatement";
import { LetStatement } from "../src/parser/ast/statements/LetStatement";
import { WhileStatement } from "../src/parser/ast/statements/WhileStatement";

describe("Parser", () => {
  const ifSource = "if (ready) { ready = false; }";
  const ifElseSource = "if (count > 0) { total = total + count; } else { total = 0; }";
  const whileSource = "while (count < limit) { count = count + 1; }";
  const forSource =
    "for (let i: i32 = 0; i < 3; i = i + 1) { sum = sum + i; }";

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

  test("parses standalone if statement", () => {
    const parser = new Parser(ifSource);
    const program = parser.parse();

    assert.equal(program.statements.length, 1);

    const stmt = program.statements[0];
    assert.ok(stmt instanceof IfStatement, "expected IfStatement");

    const ifStmt = stmt as IfStatement;
    assert.ok(ifStmt.conditionExpr, "missing condition expression");
    assert.equal(ifStmt.conditionExpr.type, "expression");

    assert.ok(ifStmt.thenBlock instanceof BlockStatement, "missing then block");
    assert.ok(ifStmt.thenBlock.statements.length > 0, "then block should contain statements");
    assert.equal(ifStmt.elseBlock, undefined);
  });

  test("parses standalone if/else statement", () => {
    const parser = new Parser(ifElseSource);
    const program = parser.parse();

    assert.equal(program.statements.length, 1);

    const stmt = program.statements[0];
    assert.ok(stmt instanceof IfStatement, "expected IfStatement");

    const ifStmt = stmt as IfStatement;
    assert.ok(ifStmt.conditionExpr, "missing condition expression");
    assert.equal(ifStmt.conditionExpr.type, "expression");

    assert.ok(ifStmt.thenBlock instanceof BlockStatement, "missing then block");
    assert.ok(ifStmt.thenBlock.statements.length > 0, "then block should contain statements");

    assert.ok(ifStmt.elseBlock instanceof BlockStatement, "missing else block");
    assert.ok(ifStmt.elseBlock?.statements.length, "else block should contain statements");
  });

  test("parses standalone while loop", () => {
    const parser = new Parser(whileSource);
    const program = parser.parse();

    assert.equal(program.statements.length, 1);

    const stmt = program.statements[0];
    assert.ok(stmt instanceof WhileStatement, "expected WhileStatement");

    const whileStmt = stmt as WhileStatement;
    assert.ok(whileStmt.condExpr, "missing loop condition");
    assert.equal(whileStmt.condExpr.type, "expression");

    assert.ok(whileStmt.loopBody instanceof BlockStatement, "missing loop body block");
    assert.ok(
      whileStmt.loopBody.statements.length > 0,
      "loop body should include parsed statements"
    );
  });

  test("parses standalone for loop", () => {
    const parser = new Parser(forSource);
    const program = parser.parse();

    assert.equal(program.statements.length, 1);

    const stmt = program.statements[0];
    assert.ok(stmt instanceof ForStatement, "expected ForStatement");

    const forStmt = stmt as ForStatement;
    assert.ok(forStmt.initBlock instanceof LetStatement, "missing for-loop initializer");

    assert.ok(
      forStmt.conditionExpr instanceof ExpressionStatement,
      "missing for-loop condition"
    );
    assert.ok(
      forStmt.conditionExpr.expression,
      "for-loop condition expression should be populated"
    );

    assert.ok(
      forStmt.updateExpr instanceof ExpressionStatement,
      "missing for-loop update expression"
    );
    assert.ok(
      forStmt.updateExpr.expression,
      "for-loop update expression should be populated"
    );

    assert.ok(forStmt.loopBody instanceof BlockStatement, "missing loop body block");
    assert.ok(
      forStmt.loopBody.statements.length > 0,
      "for-loop body should include parsed statements"
    );
  });
});
