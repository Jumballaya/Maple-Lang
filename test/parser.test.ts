import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Parser } from "../src/parser/Parser";
import { BlockStatement } from "../src/parser/ast/statements/BlockStatement";
import { ExpressionStatement } from "../src/parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../src/parser/ast/statements/ForStatement";
import { IfStatement } from "../src/parser/ast/statements/IfStatement";
import { LetStatement } from "../src/parser/ast/statements/LetStatement";
import { WhileStatement } from "../src/parser/ast/statements/WhileStatement";

const ANY = Symbol("ANY");

type Expectation =
  | typeof ANY
  | ((value: unknown) => boolean)
  | { [key: string]: Expectation }
  | Expectation[]
  | string
  | number
  | boolean
  | null;

const isAstNode = (value: unknown): value is { type: "expression" | "statement" } => {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    ((value as { type: unknown }).type === "expression" ||
      (value as { type: unknown }).type === "statement")
  );
};

const pickKey = (node: Record<string, unknown>, candidates: string[]): string | undefined => {
  return candidates.find((key) => Object.prototype.hasOwnProperty.call(node, key));
};

const assignSerialized = (
  result: Record<string, unknown>,
  handled: Set<string>,
  key: string,
  value: unknown
) => {
  handled.add(key);
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    result[key] = value.map((item) => (isAstNode(item) ? serializeAstNode(item) : item));
    return;
  }
  if (isAstNode(value)) {
    result[key] = serializeAstNode(value);
    return;
  }
  if (typeof value !== "function") {
    result[key] = value;
  }
};

const serializeAstNode = (node: { [key: string]: unknown }): Record<string, unknown> => {
  const constructorName = node.constructor?.name ?? "Object";
  const result: Record<string, unknown> = { kind: constructorName };

  if (typeof (node as { tokenLiteral?: () => unknown }).tokenLiteral === "function") {
    const literal = (node as { tokenLiteral: () => unknown }).tokenLiteral();
    if (literal !== undefined && literal !== null) {
      result.literal = literal as string | number | boolean;
    }
  }

  const handled = new Set<string>();
  const pickAndAssign = (alias: string, candidates: string[]) => {
    const key = pickKey(node, candidates);
    if (key) {
      assignSerialized(result, handled, alias, node[key]);
    }
  };

  switch (constructorName) {
    case "CallExpression":
      pickAndAssign("callee", ["callee", "callable", "function", "func", "fn", "expression"]);
      pickAndAssign("arguments", ["arguments", "args", "parameters", "argumentsList"]);
      break;
    case "MemberExpression":
      pickAndAssign("object", ["object", "target", "expr", "left"]);
      pickAndAssign("property", ["property", "member", "right"]);
      break;
    case "PointerMemberExpression":
      pickAndAssign("pointer", ["pointer", "object", "target", "expr", "left"]);
      pickAndAssign("member", ["member", "property", "right"]);
      break;
    case "IndexExpression":
      pickAndAssign("left", ["left", "object", "target", "array"]);
      pickAndAssign("index", ["index", "argument", "property"]);
      break;
    case "PrefixExpression":
      pickAndAssign("right", ["right", "operand", "expression"]);
      if ("operator" in node) {
        assignSerialized(result, handled, "operator", (node as { operator: unknown }).operator);
      }
      break;
    case "PostfixExpression":
      pickAndAssign("left", ["left", "operand", "expression", "argument"]);
      if ("operator" in node) {
        assignSerialized(result, handled, "operator", (node as { operator: unknown }).operator);
      }
      break;
    case "InfixExpression":
      pickAndAssign("left", ["left", "lhs"]);
      pickAndAssign("right", ["right", "rhs"]);
      if ("operator" in node) {
        assignSerialized(result, handled, "operator", (node as { operator: unknown }).operator);
      }
      break;
  }

  for (const key of Object.keys(node)) {
    if (key === "token" || key === "type" || handled.has(key)) {
      continue;
    }
    assignSerialized(result, handled, key, node[key]);
  }

  if (!("literal" in result)) {
    delete result.literal;
  }

  return result;
};

const serializeProgram = (program: { statements: Array<{ [key: string]: unknown }> }) => {
  return {
    kind: program.constructor?.name ?? "ASTProgram",
    statements: program.statements.map((stmt) => serializeAstNode(stmt)),
  };
};

const matchesStructure = (actual: unknown, expected: Expectation, path = "value"): void => {
  if (expected === ANY) {
    return;
  }

  if (typeof expected === "function") {
    assert.ok(expected(actual), `Expected predicate to pass at ${path}`);
    return;
  }

  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `Expected array at ${path}`);
    assert.equal(
      (actual as unknown[]).length,
      expected.length,
      `Expected array of length ${expected.length} at ${path}`
    );
    for (let i = 0; i < expected.length; i++) {
      matchesStructure((actual as unknown[])[i], expected[i]!, `${path}[${i}]`);
    }
    return;
  }

  if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object", `Expected object at ${path}`);
    for (const [key, value] of Object.entries(expected)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(actual as Record<string, unknown>, key),
        `Missing key ${path}.${key}`
      );
      matchesStructure((actual as Record<string, unknown>)[key], value, `${path}.${key}`);
    }
    return;
  }

  assert.equal(actual, expected, `Mismatch at ${path}`);
};

const expectSerializedProgram = (source: string, expected: Expectation) => {
  const parser = new Parser(source);
  const program = parser.parse();
  const serialized = serializeProgram(program);
  matchesStructure(serialized, expected);
};

const readParserErrors = (parser: Parser): string[] => {
  const candidate = (parser as unknown as { errors?: unknown }).errors;
  if (!Array.isArray(candidate)) {
    return [];
  }
  return candidate.map((item) => `${item}`);
};

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

  describe("error recovery", () => {
    test("reports missing delimiter in let statement", () => {
      const parser = new Parser("let broken i32;");
      parser.parse();

      assert.ok("errors" in parser, "parser should expose errors collection");
      const errors = readParserErrors(parser);

      assert.ok(errors.length > 0, "expected parser to report syntax issues");
      assert.ok(
        errors.some((msg) => /i32/i.test(msg) || /type/.test(msg.toLowerCase())),
        "error message should reference the unexpected token"
      );
    });

    test("collects multiple errors for missing semicolons", () => {
      const parser = new Parser(
        [
          "let first: i32 = 1",
          "let second: i32 = 2",
          "let third: i32 = 3",
        ].join("\n")
      );
      parser.parse();

      assert.ok("errors" in parser, "parser should expose errors collection");
      const errors = readParserErrors(parser);

      assert.ok(errors.length >= 2, "expected parser to keep reporting errors");
      const semicolonMentions = errors.filter((msg) =>
        msg.toLowerCase().includes("semicolon") || msg.includes(";")
      );
      assert.ok(
        semicolonMentions.length >= 2,
        "expected messages to mention missing semicolons"
      );
    });
  });

  describe("expression precedence", () => {
    test("respects arithmetic precedence", () => {
      expectSerializedProgram("1 + 2 * 3 - 4 / 2;", {
        kind: "ASTProgram",
        statements: [
          {
            kind: "ExpressionStatement",
            literal: "1",
            expression: {
              kind: "InfixExpression",
              operator: "-",
              left: {
                kind: "InfixExpression",
                operator: "+",
                left: { literal: "1" },
                right: {
                  kind: "InfixExpression",
                  operator: "*",
                  left: { literal: "2" },
                  right: { literal: "3" },
                },
              },
              right: {
                kind: "InfixExpression",
                operator: "/",
                left: { literal: "4" },
                right: { literal: "2" },
              },
            },
          },
        ],
      });
    });

    test("respects logical operator precedence", () => {
      expectSerializedProgram("ready && armed || manual && override;", {
        kind: "ASTProgram",
        statements: [
          {
            kind: "ExpressionStatement",
            literal: "ready",
            expression: {
              kind: "InfixExpression",
              operator: "||",
              left: {
                kind: "InfixExpression",
                operator: "&&",
                left: { literal: "ready" },
                right: { literal: "armed" },
              },
              right: {
                kind: "InfixExpression",
                operator: "&&",
                left: { literal: "manual" },
                right: { literal: "override" },
              },
            },
          },
        ],
      });
    });

    test("binds pointer and member operations correctly", () => {
      expectSerializedProgram("*ptr->next->value;", {
        kind: "ASTProgram",
        statements: [
          {
            kind: "ExpressionStatement",
            literal: "*",
            expression: {
              kind: "PrefixExpression",
              operator: "*",
              right: {
                kind: "PointerMemberExpression",
                member: { literal: "value" },
                pointer: {
                  kind: "PointerMemberExpression",
                  member: { literal: "next" },
                  pointer: { literal: "ptr" },
                },
              },
            },
          },
        ],
      });
    });

    test("supports chained call, index, and member expressions", () => {
      expectSerializedProgram("build()(input).result[index].name;", {
        kind: "ASTProgram",
        statements: [
          {
            kind: "ExpressionStatement",
            literal: "build",
            expression: {
              kind: "MemberExpression",
              property: { literal: "name" },
              object: {
                kind: "IndexExpression",
                index: { literal: "index" },
                left: {
                  kind: "MemberExpression",
                  property: { literal: "result" },
                  object: {
                    kind: "CallExpression",
                    arguments: [{ literal: "input" }],
                    callee: {
                      kind: "CallExpression",
                      arguments: [],
                      callee: { literal: "build" },
                    },
                  },
                },
              },
            },
          },
        ],
      });
    });
  });
});
