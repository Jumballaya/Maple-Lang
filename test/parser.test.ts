import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { Parser } from "../src/parser/Parser";
import { ExpressionStatement } from "../src/parser/ast/statements/ExpressionStatement";
import { FunctionStatement } from "../src/parser/ast/statements/FunctionStatement";
import { LetStatement } from "../src/parser/ast/statements/LetStatement";
import { ReturnStatement } from "../src/parser/ast/statements/ReturnStatement";
import { Identifier } from "../src/parser/ast/expressions/Identifier";
import { InfixExpression } from "../src/parser/ast/expressions/InfixExpression";
import { IntegerLiteralExpression } from "../src/parser/ast/expressions/IntegerLiteral";

const parseProgram = (source: string) => {
  const parser = new Parser(source);
  return parser.parse();
};

const expectLetStatement = (stmt: unknown): LetStatement => {
  assert.ok(stmt instanceof LetStatement, "expected a let/const statement");
  const letStmt = stmt as LetStatement;
  assert.equal(
    typeof letStmt.tokenLiteral,
    "function",
    "let statement should expose token literal helper"
  );
  assert.ok(letStmt.identifier, "missing identifier on let statement");
  assert.ok(letStmt.identifier.token?.literal, "identifier missing literal");
  assert.equal(
    typeof letStmt.typeAnnotation,
    "string",
    "missing type annotation on let statement"
  );
  return letStmt;
};

type FunctionStatementWithMetadata = FunctionStatement & {
  identifier: Identifier;
  fnExpr: FunctionStatement["fnExpr"] & {
    parameters: Array<{ identifier: Identifier; typeAnnotation: string }>;
    returnType: string | null;
    body: { statements: unknown[] };
  };
};

const expectFunctionStatement = (
  stmt: unknown
): FunctionStatementWithMetadata => {
  assert.ok(stmt instanceof FunctionStatement, "expected function statement");
  const fnStmt = stmt as FunctionStatementWithMetadata;
  assert.equal(
    typeof fnStmt.tokenLiteral,
    "function",
    "function statement should expose token literal helper"
  );
  assert.ok(fnStmt.identifier, "function statement missing identifier");
  assert.ok(fnStmt.fnExpr, "function statement missing literal expression");
  return fnStmt;
};

describe("Parser", () => {
  test("can accept source text", () => {
    const src = "let x: i32 = 41 + 1;";
    assert.doesNotThrow(() => {
      void new Parser(src);
    });
  });

  test("parses empty program without statements", () => {
    const program = parseProgram("");
    assert.ok(program, "parser did not return a program");
    assert.equal(program.statements.length, 0);
    assert.equal(program.tokenLiteral(), "");
  });

  test("parses single let statement without trailing whitespace", () => {
    const program = parseProgram("let answer: i32 = 42;");

    assert.equal(program.statements.length, 1);
    const statement = expectLetStatement(program.statements[0]);
    assert.equal(statement.tokenLiteral(), "let");
    assert.equal(statement.identifier.token.literal, "answer");
    assert.equal(statement.typeAnnotation, "i32");
    assert.ok(statement.expression, "let statement missing initializer");
    assert.equal(statement.expression?.tokenLiteral(), "42");
  });

  test("parses single const statement with trailing whitespace", () => {
    const program = parseProgram("const max: i32 = 100;   ");

    assert.equal(program.statements.length, 1);
    const statement = expectLetStatement(program.statements[0]);
    assert.equal(statement.tokenLiteral(), "const");
    assert.equal(statement.identifier.token.literal, "max");
    assert.equal(statement.typeAnnotation, "i32");
    assert.ok(statement.expression, "const statement missing initializer");
    assert.equal(statement.expression?.tokenLiteral(), "100");
  });

  test("parses multiple let and const statements", () => {
    const source = "let count: i32 = 1;\nconst next: i32 = count;";
    const program = parseProgram(source);

    assert.equal(program.statements.length, 2);

    const first = expectLetStatement(program.statements[0]);
    assert.equal(first.tokenLiteral(), "let");
    assert.equal(first.identifier.token.literal, "count");
    assert.equal(first.typeAnnotation, "i32");
    assert.equal(first.expression?.tokenLiteral(), "1");

    const second = expectLetStatement(program.statements[1]);
    assert.equal(second.tokenLiteral(), "const");
    assert.equal(second.identifier.token.literal, "next");
    assert.equal(second.typeAnnotation, "i32");
    assert.equal(second.expression?.tokenLiteral(), "count");
  });

  test("parses minimal function with return statement", () => {
    const program = parseProgram("fn identity(): i32 { return 1; }");

    assert.equal(program.statements.length, 1);

    const fnStmt = expectFunctionStatement(program.statements[0]);
    assert.equal(fnStmt.identifier.token.literal, "identity");
    assert.equal(fnStmt.fnExpr.parameters.length, 0);
    assert.equal(fnStmt.fnExpr.returnType, "i32");

    const body = fnStmt.fnExpr.body;
    assert.equal(body.statements.length, 1, "function body should include return");
    const returnStmt = body.statements[0];
    assert.ok(returnStmt instanceof ReturnStatement);
    const returnValue = (returnStmt as ReturnStatement).returnValue;
    assert.ok(returnValue instanceof IntegerLiteralExpression);
    assert.equal(returnValue.tokenLiteral(), "1");
  });

  test("parses multi-parameter function with expression statements", () => {
    const program = parseProgram(
      "fn add(lhs: i32, rhs: i32): i32 { lhs + rhs; return lhs; }"
    );

    assert.equal(program.statements.length, 1);

    const fnStmt = expectFunctionStatement(program.statements[0]);
    assert.equal(fnStmt.identifier.token.literal, "add");
    assert.equal(fnStmt.fnExpr.parameters.length, 2);
    assert.deepEqual(
      fnStmt.fnExpr.parameters.map((param) => param.identifier.token.literal),
      ["lhs", "rhs"]
    );
    assert.deepEqual(
      fnStmt.fnExpr.parameters.map((param) => param.typeAnnotation),
      ["i32", "i32"]
    );
    assert.equal(fnStmt.fnExpr.returnType, "i32");

    const body = fnStmt.fnExpr.body;
    assert.equal(body.statements.length, 2, "function body should capture statements");

    const [exprStmt, retStmt] = body.statements;
    assert.ok(exprStmt instanceof ExpressionStatement);
    const expression = (exprStmt as ExpressionStatement).expression;
    assert.ok(expression instanceof InfixExpression);
    assert.equal((expression as InfixExpression).left.tokenLiteral(), "lhs");
    assert.equal((expression as InfixExpression).operator, "+");
    assert.equal((expression as InfixExpression).right.tokenLiteral(), "rhs");

    assert.ok(retStmt instanceof ReturnStatement);
    const returnValue = (retStmt as ReturnStatement).returnValue;
    assert.ok(returnValue instanceof Identifier);
    assert.equal(returnValue.tokenLiteral(), "lhs");
  });
});
