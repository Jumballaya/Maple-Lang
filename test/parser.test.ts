import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Parser } from "../src/parser/Parser";
import { ImportStatement } from "../src/parser/ast/statements/ImportStatement";
import { FunctionStatement } from "../src/parser/ast/statements/FunctionStatement";
import { ReturnStatement } from "../src/parser/ast/statements/ReturnStatement";
import { InfixExpression } from "../src/parser/ast/expressions/InfixExpression";
import { Identifier } from "../src/parser/ast/expressions/Identifier";
import { StructStatement } from "../src/parser/ast/statements/StructStatement";
import { LetStatement } from "../src/parser/ast/statements/LetStatement";
import { StructLiteralExpression } from "../src/parser/ast/expressions/StructLiteralExpression";
import { IntegerLiteralExpression } from "../src/parser/ast/expressions/IntegerLiteral";
import { FloatLiteralExpression } from "../src/parser/ast/expressions/FloatLiteralExpression";
import { ExpressionStatement } from "../src/parser/ast/statements/ExpressionStatement";
import { AssignmentExpression } from "../src/parser/ast/expressions/AssignmentExpression";
import { BooleanLiteralExpression } from "../src/parser/ast/expressions/BooleanLiteralExpression";
import { IfStatement } from "../src/parser/ast/statements/IfStatement";
import { ASTStatement } from "../src/parser/ast/types/ast.type";
import { StructMember } from "../src/compiler/emitters/emitter.types";
import { ForStatement } from "../src/parser/ast/statements/ForStatement";
import { PrefixExpression } from "../src/parser/ast/expressions/PrefixExpression";
import { BreakStatement } from "../src/parser/ast/statements/BreakStatement";
import { WhileStatement } from "../src/parser/ast/statements/WhileStatement";
import { PostfixExpression } from "../src/parser/ast/expressions/PostfixExpression";
import { MemberExpression } from "../src/parser/ast/expressions/MemberExpression";

// @TODO:
//
//
//      Make sure .toString() is working as well, create tests for different scenarios
//
//
//      Pointers for now: Treat ALL structs as pointers, but hide it from the
//      end user. They pass around the struct type, and under the hood its
//      already just a pointer.
//
//      Later on I will add pointers, references, pointer-member access and
//      a function stack and stackframes
//
//
//      Array Access
//        1. literals       -- x[3]
//        2. variables      -- x[y]
//        3. expressions    -- x[z * 4]
//
//      Function calls and nesting
//        1. a(b(c()))
//
//        supports chained call, index, and member expressions
//          1. a.b.c[3](f.g()[4].h())
//
//              Currently only flat structs allowed.
//                  a.b[3](f.g()[4].h());
//
//
//      Errors
//        reports missing items
//        collects multiple errors
//        expression precedence
//        respects logical operator precedence
//
//

describe("Parser: Control Flow", () => {
  test("can parse an empty program", () => {
    const p = new Parser(``);
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 0);
  });

  test("can parse an import statement", () => {
    const p = new Parser(`import x from "y"`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const importStmt = ast.statements[0];
    assert(importStmt instanceof ImportStatement);
    assert(importStmt.importPath === "y");
    assert(importStmt.imported.length === 1);
    assert(importStmt.imported[0] === "x");
  });

  test("can parse an multi-import statement", () => {
    const p = new Parser(`import a, b, c from "xyz"`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    const importStmt = ast.statements[0];
    assert(importStmt instanceof ImportStatement);
    assert(importStmt.importPath === "xyz");
    assert(importStmt.imported.length === 3);
    assert(importStmt.imported[0] === "a");
    assert(importStmt.imported[1] === "b");
    assert(importStmt.imported[2] === "c");
  });

  test("can parse a function that returns void", () => {
    const p = new Parser("fn test(): void {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    assertFunctionSignature(ast.statements[0], "test", [], null, 0, false);
  });

  test("can parse an exported function", () => {
    const p = new Parser("export fn test_1(): void {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    assertFunctionSignature(ast.statements[0], "test_1", [], null, 0, true);
  });

  test("can parse a function that returns i32", () => {
    const p = new Parser("fn test_i32(): i32 {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    assertFunctionSignature(ast.statements[0], "test_i32", [], "i32", 0, false);
  });

  test("can parse a function that returns f32", () => {
    const p = new Parser("fn test_f32(): f32 {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    assertFunctionSignature(ast.statements[0], "test_f32", [], "f32", 0, false);
  });

  test("can parse a function that returns bool", () => {
    const p = new Parser("fn test_bool(): bool {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    assertFunctionSignature(
      ast.statements[0],
      "test_bool",
      [],
      "bool",
      0,
      false
    );
  });

  test("can parse a function that returns a struct", () => {
    const p = new Parser("fn test_struct(): Color {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    assertFunctionSignature(
      ast.statements[0],
      "test_struct",
      [],
      "Color",
      0,
      false
    );
  });

  test("can parse a function that returns an array", () => {
    const p = new Parser("fn test_arr(): i32[] {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    assertFunctionSignature(
      ast.statements[0],
      "test_arr",
      [],
      "i32[]",
      0,
      false
    );
  });

  test("can parse a function that takes params", () => {
    const p = new Parser("fn add(a: i32, b: i32): i32 {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const params: Array<[string, string]> = [
      ["a", "i32"],
      ["b", "i32"],
    ];
    assertFunctionSignature(ast.statements[0], "add", params, "i32", 0, false);
  });

  test("can parse a function that takes many different types of params", () => {
    const p = new Parser(
      "fn multi_func(a: i32, b: f32, c: Color, d: bool): i32 {}"
    );
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const params: [string, string][] = [
      ["a", "i32"],
      ["b", "f32"],
      ["c", "Color"],
      ["d", "bool"],
    ];
    assertFunctionSignature(
      ast.statements[0],
      "multi_func",
      params,
      "i32",
      0,
      false
    );
  });

  test("can parse a function that returns", () => {
    const p = new Parser(`
    fn func_ret(a: i32, b: i32): i32 {
      return a + b;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    const params: [string, string][] = [
      ["a", "i32"],
      ["b", "i32"],
    ];
    if (
      !assertFunctionSignature(funcStmt, "func_ret", params, "i32", 1, false)
    ) {
      return;
    }

    const returnStmt = funcStmt.fnExpr.body.statements[0];
    assert(returnStmt instanceof ReturnStatement);
    assert(returnStmt.returnValue instanceof InfixExpression);
    assert(returnStmt.returnValue.operator === "+");
    assert(returnStmt.returnValue.left instanceof Identifier);
    assert(returnStmt.returnValue.right instanceof Identifier);
    assert(returnStmt.returnValue.left.typeAnnotation === "i32");
    assert(returnStmt.returnValue.right.typeAnnotation === "i32");
    assert(returnStmt.returnValue.left.tokenLiteral() === "a");
    assert(returnStmt.returnValue.right.tokenLiteral() === "b");
  });

  test("can parse a struct definition", () => {
    const p = new Parser(`struct S {
      len: i32,
      next: f32,
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    assertStructStatement(ast.statements[0], "S", {
      len: { name: "len", offset: 0, size: 4, type: "i32" },
      next: { name: "next", offset: 4, size: 4, type: "f32" },
    });
  });

  test("can parse a struct definition (no trailing comma)", () => {
    const p = new Parser(`struct S {
      len: i32,
      next: f32
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    assertStructStatement(ast.statements[0], "S", {
      len: { name: "len", offset: 0, size: 4, type: "i32" },
      next: { name: "next", offset: 4, size: 4, type: "f32" },
    });
  });

  test("can parse a struct literal", () => {
    const p = new Parser(`
    struct T {
      apple: i32,
      banana: f32,
      _flag: bool,
    }

    let t: T = {
      apple = 10,
      banana = 20.5,
      _flag = false,
    };`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 2);
    assertStructStatement(ast.statements[0], "T", {
      apple: { name: "apple", offset: 0, size: 4, type: "i32" },
      banana: { name: "banana", offset: 4, size: 4, type: "f32" },
      _flag: { name: "_flag", offset: 8, size: 4, type: "i32" }, // bool turns into i32
    });

    const letStmt = ast.statements[1];
    assert(letStmt instanceof LetStatement);
    assert(letStmt.identifier.tokenLiteral() === "t");
    assert(
      letStmt.identifier.typeAnnotation === "T",
      `Expected type: "T", Got: "${letStmt.identifier.typeAnnotation}`
    );
    const structLit = letStmt.expression;
    assert(structLit instanceof StructLiteralExpression);
    assert(structLit.name === "T");
    assert(Object.keys(structLit.members).length === 3);
    assert(!!structLit.members["apple"]);
    assert(!!structLit.members["banana"]);
    assert(!!structLit.members["_flag"]);
    const appleExpr = structLit.members["apple"];
    const banExpr = structLit.members["banana"];
    const flagExpr = structLit.members["_flag"];
    assert(appleExpr instanceof IntegerLiteralExpression);
    assert(banExpr instanceof FloatLiteralExpression);
    assert(flagExpr instanceof BooleanLiteralExpression);
    assert(appleExpr.value === 10);
    assert(floatEquals(banExpr.value, 20.5));
    assert(flagExpr.value === false);
  });

  test("can parse a struct literal (no trailing comma)", () => {
    const p = new Parser(`
    struct S {
      len: i32,
      next: f32
    }

    let s: S = {
      len = 10,
      next = 20.5
    };`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 2);
    assertStructStatement(ast.statements[0], "S", {
      len: { name: "len", size: 4, offset: 0, type: "i32" },
      next: { name: "next", size: 4, offset: 4, type: "f32" },
    });

    const letStmt = ast.statements[1];
    assert(letStmt instanceof LetStatement);
    assert(letStmt.identifier.tokenLiteral() === "s");
    assert(letStmt.identifier.typeAnnotation === "S");
    const structLit = letStmt.expression;
    assert(structLit instanceof StructLiteralExpression);
    assert(structLit.name === "S");
    assert(Object.keys(structLit.members).length === 2);
    assert(!!structLit.members["len"]);
    assert(!!structLit.members["next"]);
    const lenExpr = structLit.members["len"];
    const nextExpr = structLit.members["next"];
    assert(lenExpr instanceof IntegerLiteralExpression);
    assert(nextExpr instanceof FloatLiteralExpression);
    assert(lenExpr.value === 10);
    assert(floatEquals(nextExpr.value, 20.5));
  });

  test("can parse an assignment expression (i32)", () => {
    const p = new Parser(`fn test_assign_i32(): i32 {
      let x: i32 = 0;
      x = 5;
      return x;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    if (
      !assertFunctionSignature(funcStmt, "test_assign_i32", [], "i32", 3, false)
    ) {
      return;
    }

    const letStmt = funcStmt.fnExpr.body.statements[0];
    assert(letStmt instanceof LetStatement);
    assert(!letStmt.exported);
    assert(letStmt.identifier.tokenLiteral() === "x");
    assert(letStmt.identifier.typeAnnotation === "i32");
    assert(letStmt.expression instanceof IntegerLiteralExpression);
    assert(letStmt.expression.value === 0);

    const assignStmt = funcStmt.fnExpr.body.statements[1];
    assert(assignStmt instanceof ExpressionStatement);
    assert(assignStmt.expression instanceof AssignmentExpression);
    assert(assignStmt.expression.left instanceof Identifier);
    assert(assignStmt.expression.left.tokenLiteral() === "x");
    assert(assignStmt.expression.left.typeAnnotation === "i32");
    assert(assignStmt.expression.value instanceof IntegerLiteralExpression);
    assert(assignStmt.expression.value.value === 5);

    const returnStmt = funcStmt.fnExpr.body.statements[2];
    assert(returnStmt instanceof ReturnStatement);
    assert(returnStmt.returnValue instanceof Identifier);
    assert(returnStmt.returnValue.tokenLiteral() === "x");
  });

  test("can parse an assignment (f32)", () => {
    const p = new Parser(`fn test_assign_f32(): f32 {
      let x: f32 = 0.0;
      x = 3.1415;
      return x;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    if (
      !assertFunctionSignature(funcStmt, "test_assign_f32", [], "f32", 3, false)
    ) {
      return;
    }

    const letStmt = funcStmt.fnExpr.body.statements[0];
    assert(letStmt instanceof LetStatement);
    assert(!letStmt.exported);
    assert(letStmt.identifier.tokenLiteral() === "x");
    assert(letStmt.identifier.typeAnnotation === "f32");
    assert(letStmt.expression instanceof FloatLiteralExpression);
    assert(floatEquals(letStmt.expression.value, 0));

    const assignStmt = funcStmt.fnExpr.body.statements[1];
    assert(assignStmt instanceof ExpressionStatement);
    assert(assignStmt.expression instanceof AssignmentExpression);
    assert(assignStmt.expression.left instanceof Identifier);
    assert(assignStmt.expression.left.tokenLiteral() === "x");
    assert(assignStmt.expression.left.typeAnnotation === "f32");
    assert(assignStmt.expression.value instanceof FloatLiteralExpression);
    assert(floatEquals(assignStmt.expression.value.value, 3.1415));

    const returnStmt = funcStmt.fnExpr.body.statements[2];
    assert(returnStmt instanceof ReturnStatement);
    assert(returnStmt.returnValue instanceof Identifier);
    assert(returnStmt.returnValue.tokenLiteral() === "x");
  });

  test("can parse an assignment (bool)", () => {
    const p = new Parser(`fn test_assign_bool(): bool {
      let x: bool = false;
      x = true;
      return x;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    if (
      !assertFunctionSignature(
        funcStmt,
        "test_assign_bool",
        [],
        "bool",
        3,
        false
      )
    ) {
      return;
    }

    const letStmt = funcStmt.fnExpr.body.statements[0];
    assert(letStmt instanceof LetStatement);
    assert(!letStmt.exported);
    assert(letStmt.identifier.tokenLiteral() === "x");
    assert(letStmt.identifier.typeAnnotation === "bool");
    assert(letStmt.expression instanceof BooleanLiteralExpression);
    assert(letStmt.expression.value === false);

    const assignStmt = funcStmt.fnExpr.body.statements[1];
    assert(assignStmt instanceof ExpressionStatement);
    assert(assignStmt.expression instanceof AssignmentExpression);
    assert(assignStmt.expression.left instanceof Identifier);
    assert(assignStmt.expression.left.tokenLiteral() === "x");
    assert(assignStmt.expression.left.typeAnnotation === "bool");
    assert(assignStmt.expression.value instanceof BooleanLiteralExpression);
    assert(assignStmt.expression.value.value === true);

    const returnStmt = funcStmt.fnExpr.body.statements[2];
    assert(returnStmt instanceof ReturnStatement);
    assert(returnStmt.returnValue instanceof Identifier);
    assert(returnStmt.returnValue.tokenLiteral() === "x");
  });

  test("can parse if statement - no else", () => {
    const p = new Parser(`fn test_if_1(n: i32): i32 {
      let x: i32 = 0;
      if (n > 10) {
        x = 5;
      }
      return x;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    const params: [string, string][] = [["n", "i32"]];
    if (
      !assertFunctionSignature(funcStmt, "test_if_1", params, "i32", 3, false)
    ) {
      return;
    }

    const letStmt = funcStmt.fnExpr.body.statements[0];
    assert(letStmt instanceof LetStatement);
    assert(!letStmt.exported);
    assert(letStmt.identifier.tokenLiteral() === "x");
    assert(letStmt.identifier.typeAnnotation === "i32");
    assert(letStmt.expression instanceof IntegerLiteralExpression);
    assert(letStmt.expression.value === 0);

    const ifStmt = funcStmt.fnExpr.body.statements[1];
    assert(ifStmt instanceof IfStatement);
    const condExp = ifStmt.conditionExpr;
    const thenBlock = ifStmt.thenBlock;
    const thenStmt = thenBlock.statements[0];
    assert(ifStmt.elseBlock === undefined);
    assert(thenBlock.statements.length === 1);
    assert(condExp instanceof InfixExpression);
    assert(thenStmt instanceof ExpressionStatement);

    assert(condExp.left instanceof Identifier);
    assert(condExp.left.typeAnnotation === "i32");
    assert(condExp.left.tokenLiteral() === "n");
    assert(condExp.right instanceof IntegerLiteralExpression);
    assert(condExp.operator === ">");
    assert(condExp.right.value === 10);

    assert(thenStmt.expression instanceof AssignmentExpression);
    assert(thenStmt.expression.left instanceof Identifier);
    assert(thenStmt.expression.left.tokenLiteral() === "x");
    assert(thenStmt.expression.left.typeAnnotation === "i32");
    assert(thenStmt.expression.value instanceof IntegerLiteralExpression);
    assert(thenStmt.expression.value.value === 5);

    const returnStmt = funcStmt.fnExpr.body.statements[2];
    assert(returnStmt instanceof ReturnStatement);
    assert(returnStmt.returnValue instanceof Identifier);
    assert(returnStmt.returnValue.tokenLiteral() === "x");
  });

  test("can parse if statement - no else, returns", () => {
    const p = new Parser(`fn test_if_2(n: i32): i32 {
      if (n > 10) {
        return 5;
      }
      return 0;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    const params: [string, string][] = [["n", "i32"]];
    if (
      !assertFunctionSignature(funcStmt, "test_if_2", params, "i32", 2, false)
    ) {
      return;
    }

    const ifStmt = funcStmt.fnExpr.body.statements[0];
    assert(ifStmt instanceof IfStatement);
    const condExp = ifStmt.conditionExpr;
    const thenBlock = ifStmt.thenBlock;
    const thenStmt = thenBlock.statements[0];
    assert(ifStmt.elseBlock === undefined);
    assert(thenBlock.statements.length === 1);
    assert(condExp instanceof InfixExpression);
    assert(thenStmt instanceof ReturnStatement);

    assert(condExp.left instanceof Identifier);
    assert(condExp.left.typeAnnotation === "i32");
    assert(condExp.left.tokenLiteral() === "n");
    assert(condExp.operator === ">");
    assert(condExp.right instanceof IntegerLiteralExpression);
    assert(condExp.right.value === 10);

    const forRetStmt = thenBlock.statements[0];
    assert(forRetStmt instanceof ReturnStatement);
    assert(forRetStmt.returnValue instanceof IntegerLiteralExpression);
    assert(forRetStmt.returnValue.value === 5);

    const returnStmt = funcStmt.fnExpr.body.statements[1];
    assert(returnStmt instanceof ReturnStatement);
    assert(returnStmt.returnValue instanceof IntegerLiteralExpression);
    assert(returnStmt.returnValue.value === 0);
  });

  test("can parse if statement - with else", () => {
    const p = new Parser(`fn test_if_3(n: i32): i32 {
      let x: i32 = 0;
      if (n > 10) {
        x = 5;
      } else {
        x = 15;
      }
      return x;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    const params: [string, string][] = [["n", "i32"]];
    if (
      !assertFunctionSignature(funcStmt, "test_if_3", params, "i32", 3, false)
    ) {
      return;
    }

    const letStmt = funcStmt.fnExpr.body.statements[0];
    assert(letStmt instanceof LetStatement);
    assert(!letStmt.exported);
    assert(letStmt.identifier.tokenLiteral() === "x");
    assert(letStmt.identifier.typeAnnotation === "i32");

    assert(letStmt.expression instanceof IntegerLiteralExpression);
    assert(letStmt.expression.value === 0);

    const ifStmt = funcStmt.fnExpr.body.statements[1];
    assert(ifStmt instanceof IfStatement);
    const condExp = ifStmt.conditionExpr;
    const thenBlock = ifStmt.thenBlock;
    const elseBlock = ifStmt.elseBlock;
    const thenStmt = thenBlock.statements[0];
    const elseStmt = elseBlock?.statements[0];
    assert(elseBlock && elseStmt);
    assert(elseBlock.statements.length === 1);
    assert(thenBlock.statements.length === 1);
    assert(condExp instanceof InfixExpression);
    assert(thenStmt instanceof ExpressionStatement);
    assert(elseStmt instanceof ExpressionStatement);

    assert(condExp.left instanceof Identifier);
    assert(condExp.left.typeAnnotation === "i32");
    assert(condExp.left.tokenLiteral() === "n");
    assert(condExp.operator === ">");
    assert(condExp.right instanceof IntegerLiteralExpression);
    assert(condExp.right.value === 10);

    assert(thenStmt instanceof ExpressionStatement);
    assert(thenStmt.expression instanceof AssignmentExpression);
    assert(thenStmt.expression.left instanceof Identifier);
    assert(thenStmt.expression.left.tokenLiteral() === "x");

    assert(thenStmt.expression.left.typeAnnotation === "i32");
    assert(thenStmt.expression.value instanceof IntegerLiteralExpression);
    assert(thenStmt.expression.value.value === 5);

    assert(elseStmt instanceof ExpressionStatement);
    assert(elseStmt.expression instanceof AssignmentExpression);
    assert(elseStmt.expression.left instanceof Identifier);
    assert(elseStmt.expression.left.tokenLiteral() === "x");

    assert(elseStmt.expression.left.typeAnnotation === "i32");
    assert(elseStmt.expression.value instanceof IntegerLiteralExpression);
    assert(elseStmt.expression.value.value === 15);

    const returnStmt = funcStmt.fnExpr.body.statements[2];
    assert(returnStmt instanceof ReturnStatement);
    assert(returnStmt.returnValue instanceof Identifier);
    assert(returnStmt.returnValue.tokenLiteral() === "x");
  });

  test("can parse if statement - with else, returns", () => {
    const p = new Parser(`fn test_if_4(n: i32): i32 {
      if (n > 10) {
        return 5;
      } else {
        return 15;
      }
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    const params: [string, string][] = [["n", "i32"]];
    if (
      !assertFunctionSignature(funcStmt, "test_if_4", params, "i32", 1, false)
    ) {
      return;
    }

    const ifStmt = funcStmt.fnExpr.body.statements[0];
    assert(ifStmt instanceof IfStatement);
    const condExp = ifStmt.conditionExpr;
    const thenBlock = ifStmt.thenBlock;
    const elseBlock = ifStmt.elseBlock;
    const thenStmt = thenBlock.statements[0];
    const elseStmt = elseBlock?.statements[0];
    assert(elseBlock && elseStmt);
    assert(elseBlock.statements.length === 1);
    assert(thenBlock.statements.length === 1);
    assert(condExp instanceof InfixExpression);
    assert(thenStmt instanceof ReturnStatement);
    assert(elseStmt instanceof ReturnStatement);

    assert(condExp.left instanceof Identifier);
    assert(condExp.left.typeAnnotation === "i32");
    assert(condExp.left.tokenLiteral() === "n");
    assert(condExp.operator === ">");
    assert(condExp.right instanceof IntegerLiteralExpression);
    assert(condExp.right.value === 10);

    assert(thenStmt.returnValue instanceof IntegerLiteralExpression);
    assert(thenStmt.returnValue.value === 5);

    assert(elseStmt.returnValue instanceof IntegerLiteralExpression);
    assert(elseStmt.returnValue.value === 15);
  });

  test("can parse if statement with boolean condition", () => {
    const p = new Parser(`fn test_if_5(b: bool): i32 {
      if (b) {
        return 5;
      } else {
        return 15;
      }
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    const params: [string, string][] = [["b", "bool"]];
    if (
      !assertFunctionSignature(funcStmt, "test_if_5", params, "i32", 1, false)
    ) {
      return;
    }

    const ifStmt = funcStmt.fnExpr.body.statements[0];
    assert(ifStmt instanceof IfStatement);
    const condExp = ifStmt.conditionExpr;
    const thenBlock = ifStmt.thenBlock;
    const elseBlock = ifStmt.elseBlock;
    const thenStmt = thenBlock.statements[0];
    const elseStmt = elseBlock?.statements[0];
    assert(elseBlock && elseStmt);
    assert(elseBlock.statements.length === 1);
    assert(thenBlock.statements.length === 1);
    assert(condExp instanceof Identifier);
    assert(thenStmt instanceof ReturnStatement);
    assert(elseStmt instanceof ReturnStatement);

    assert(condExp.tokenLiteral() === "b");

    assert(thenStmt.returnValue instanceof IntegerLiteralExpression);
    assert(thenStmt.returnValue.value === 5);

    assert(elseStmt.returnValue instanceof IntegerLiteralExpression);
    assert(elseStmt.returnValue.value === 15);
  });

  test("can parse if statement with integer", () => {
    const p = new Parser(`fn test_if_6(i: i32): i32 {
      if (i) {
        return 5;
      } else {
        return 15;
      }
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    const params: [string, string][] = [["i", "i32"]];
    if (
      !assertFunctionSignature(funcStmt, "test_if_6", params, "i32", 1, false)
    ) {
      return;
    }

    const ifStmt = funcStmt.fnExpr.body.statements[0];
    assert(ifStmt instanceof IfStatement);
    const condExp = ifStmt.conditionExpr;
    const thenBlock = ifStmt.thenBlock;
    const elseBlock = ifStmt.elseBlock;
    const thenStmt = thenBlock.statements[0];
    const elseStmt = elseBlock?.statements[0];
    assert(elseBlock && elseStmt);
    assert(elseBlock.statements.length === 1);
    assert(thenBlock.statements.length === 1);
    assert(condExp instanceof Identifier);
    assert(thenStmt instanceof ReturnStatement);
    assert(elseStmt instanceof ReturnStatement);

    assert(condExp.tokenLiteral() === "i");

    assert(thenStmt.returnValue instanceof IntegerLiteralExpression);
    assert(thenStmt.returnValue.value === 5);

    assert(elseStmt.returnValue instanceof IntegerLiteralExpression);
    assert(elseStmt.returnValue.value === 15);
  });

  test("can parse a for loop, empty", () => {
    const p = new Parser(`fn test_for_1(): void {
      for (let i: i32 = 0; i < 10; i = i + 1) {}
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    if (!assertFunctionSignature(funcStmt, "test_for_1", [], null, 1, false)) {
      return;
    }

    const forStmt = funcStmt.fnExpr.body.statements[0];
    assert(forStmt instanceof ForStatement);
    assert(forStmt.loopBody.statements.length === 0);

    const initBlock = forStmt.initBlock;
    assert(!initBlock.exported);
    assert(initBlock.identifier.tokenLiteral() === "i");
    assert(initBlock.identifier.typeAnnotation === "i32");
    assert(initBlock.expression instanceof IntegerLiteralExpression);
    assert(initBlock.expression.value === 0);

    const condExpr = forStmt.conditionExpr.expression;
    assert(condExpr instanceof InfixExpression);
    assert(condExpr.left instanceof Identifier);
    assert(condExpr.right instanceof IntegerLiteralExpression);
    assert(condExpr.left.tokenLiteral() === "i");
    assert(condExpr.left.typeAnnotation === "i32");
    assert(condExpr.operator === "<");
    assert(condExpr.right.value === 10);

    const updateExpr = forStmt.updateExpr.expression;
    assert(updateExpr instanceof AssignmentExpression);
    assert(updateExpr.left instanceof Identifier);
    assert(updateExpr.value instanceof InfixExpression);
    assert(updateExpr.value.left instanceof Identifier);
    assert(updateExpr.value.right instanceof IntegerLiteralExpression);
    assert(updateExpr.left.tokenLiteral() === "i");
    assert(updateExpr.left.typeAnnotation === "i32");
    assert(updateExpr.value.left.tokenLiteral() === "i");
    assert(updateExpr.value.left.typeAnnotation === "i32");
    assert(updateExpr.value.operator === "+");
    assert(updateExpr.value.right.value === 1);
  });

  test("can parse a for loop not starting from 0", () => {
    const p = new Parser(`fn test_for_2(): void {
      for (let i: i32 = 17; i < 22; i = i + 1) {}
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    if (!assertFunctionSignature(funcStmt, "test_for_2", [], null, 1, false)) {
      return;
    }

    const forStmt = funcStmt.fnExpr.body.statements[0];
    assert(forStmt instanceof ForStatement);
    assert(forStmt.loopBody.statements.length === 0);

    const initBlock = forStmt.initBlock;
    assert(!initBlock.exported);
    assert(initBlock.identifier.tokenLiteral() === "i");
    assert(initBlock.identifier.typeAnnotation === "i32");
    assert(initBlock.expression instanceof IntegerLiteralExpression);
    assert(initBlock.expression.value === 17);

    const condExpr = forStmt.conditionExpr.expression;
    assert(condExpr instanceof InfixExpression);
    assert(condExpr.left instanceof Identifier);
    assert(condExpr.right instanceof IntegerLiteralExpression);
    assert(condExpr.left.tokenLiteral() === "i");
    assert(condExpr.left.typeAnnotation === "i32");
    assert(condExpr.operator === "<");
    assert(condExpr.right.value === 22);

    const updateExpr = forStmt.updateExpr.expression;
    assert(updateExpr instanceof AssignmentExpression);
    assert(updateExpr.left instanceof Identifier);
    assert(updateExpr.value instanceof InfixExpression);
    assert(updateExpr.value.left instanceof Identifier);
    assert(updateExpr.value.right instanceof IntegerLiteralExpression);
    assert(updateExpr.left.tokenLiteral() === "i");
    assert(updateExpr.left.typeAnnotation === "i32");
    assert(updateExpr.value.left.tokenLiteral() === "i");
    assert(updateExpr.value.left.typeAnnotation === "i32");
    assert(updateExpr.value.operator === "+");
    assert(updateExpr.value.right.value === 1);
  });

  test("can parse a for loop starting from negative", () => {
    const p = new Parser(`fn test_for_3(): void {
      for (let i: i32 = -3; i < 7; i = i + 1) {}
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    if (!assertFunctionSignature(funcStmt, "test_for_3", [], null, 1, false)) {
      return;
    }

    const forStmt = funcStmt.fnExpr.body.statements[0];
    assert(forStmt instanceof ForStatement);
    assert(forStmt.loopBody.statements.length === 0);

    const initBlock = forStmt.initBlock;
    assert(!initBlock.exported);
    assert(initBlock.identifier.tokenLiteral() === "i");
    assert(initBlock.identifier.typeAnnotation === "i32");
    assert(initBlock.expression instanceof PrefixExpression);
    assert(initBlock.expression.operator === "-");
    assert(initBlock.expression.right instanceof IntegerLiteralExpression);
    assert(initBlock.expression.right.value === 3);

    const condExpr = forStmt.conditionExpr.expression;
    assert(condExpr instanceof InfixExpression);
    assert(condExpr.left instanceof Identifier);
    assert(condExpr.right instanceof IntegerLiteralExpression);
    assert(condExpr.left.tokenLiteral() === "i");
    assert(condExpr.left.typeAnnotation === "i32");
    assert(condExpr.operator === "<");
    assert(condExpr.right.value === 7);

    const updateExpr = forStmt.updateExpr.expression;
    assert(updateExpr instanceof AssignmentExpression);
    assert(updateExpr.left instanceof Identifier);
    assert(updateExpr.value instanceof InfixExpression);
    assert(updateExpr.value.left instanceof Identifier);
    assert(updateExpr.value.right instanceof IntegerLiteralExpression);
    assert(updateExpr.left.tokenLiteral() === "i");
    assert(updateExpr.left.typeAnnotation === "i32");
    assert(updateExpr.value.left.tokenLiteral() === "i");
    assert(updateExpr.value.left.typeAnnotation === "i32");
    assert(updateExpr.value.operator === "+");
    assert(updateExpr.value.right.value === 1);
  });

  test("can parse a for loop with a body", () => {
    const p = new Parser(`fn test_for_4(): void {
      for (let i: i32 = 0; i < 10; i = i + 1) {
        let x: i32 = 0;
        x = i;
      }
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    if (!assertFunctionSignature(funcStmt, "test_for_4", [], null, 1, false)) {
      return;
    }

    const forStmt = funcStmt.fnExpr.body.statements[0];
    assert(forStmt instanceof ForStatement);
    assert(forStmt.loopBody.statements.length === 2);

    const initBlock = forStmt.initBlock;
    assert(!initBlock.exported);
    assert(initBlock.identifier.tokenLiteral() === "i");
    assert(initBlock.identifier.typeAnnotation === "i32");
    assert(initBlock.expression instanceof IntegerLiteralExpression);
    assert(initBlock.expression.value === 0);

    const condExpr = forStmt.conditionExpr.expression;
    assert(condExpr instanceof InfixExpression);
    assert(condExpr.left instanceof Identifier);
    assert(condExpr.right instanceof IntegerLiteralExpression);
    assert(condExpr.left.tokenLiteral() === "i");
    assert(condExpr.left.typeAnnotation === "i32");
    assert(condExpr.operator === "<");
    assert(condExpr.right.value === 10);

    const updateExpr = forStmt.updateExpr.expression;
    assert(updateExpr instanceof AssignmentExpression);
    assert(updateExpr.left instanceof Identifier);
    assert(updateExpr.value instanceof InfixExpression);
    assert(updateExpr.value.left instanceof Identifier);
    assert(updateExpr.value.right instanceof IntegerLiteralExpression);
    assert(updateExpr.left.tokenLiteral() === "i");
    assert(updateExpr.left.typeAnnotation === "i32");
    assert(updateExpr.value.left.tokenLiteral() === "i");
    assert(updateExpr.value.left.typeAnnotation === "i32");
    assert(updateExpr.value.operator === "+");
    assert(updateExpr.value.right.value === 1);

    const letStmt = forStmt.loopBody.statements[0];
    const assignStmt = forStmt.loopBody.statements[1];
    assert(letStmt instanceof LetStatement);
    assert(assignStmt instanceof ExpressionStatement);

    assert(!letStmt.exported);
    assert(letStmt.identifier.tokenLiteral() === "x");
    assert(letStmt.identifier.typeAnnotation === "i32");
    assert(letStmt.expression instanceof IntegerLiteralExpression);
    assert(letStmt.expression.value === 0);

    const assignExpr = assignStmt.expression;
    assert(assignExpr instanceof AssignmentExpression);
    assert(assignExpr.left instanceof Identifier);
    assert(assignExpr.value instanceof Identifier);
    assert(assignExpr.left.tokenLiteral() === "x");
    assert(assignExpr.left.typeAnnotation === "i32");
    assert(assignExpr.value.tokenLiteral() === "i");
    assert(assignExpr.value.typeAnnotation === "i32");
  });

  test("can parse a for loop with a return", () => {
    const p = new Parser(`fn test_for_5(): i32 {
      for (let i: i32 = 0; i < 10; i = i + 1) {
        if (i > 7) {
          return i;
        }
      }
      return 0;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    if (!assertFunctionSignature(funcStmt, "test_for_5", [], "i32", 2, false)) {
      return;
    }

    const forStmt = funcStmt.fnExpr.body.statements[0];
    assert(forStmt instanceof ForStatement);
    assert(forStmt.loopBody.statements.length === 1);

    const initBlock = forStmt.initBlock;
    assert(!initBlock.exported);
    assert(initBlock.identifier.tokenLiteral() === "i");
    assert(initBlock.identifier.typeAnnotation === "i32");
    assert(initBlock.expression instanceof IntegerLiteralExpression);
    assert(initBlock.expression.value === 0);

    const condExpr = forStmt.conditionExpr.expression;
    assert(condExpr instanceof InfixExpression);
    assert(condExpr.left instanceof Identifier);
    assert(condExpr.right instanceof IntegerLiteralExpression);
    assert(condExpr.left.tokenLiteral() === "i");
    assert(condExpr.left.typeAnnotation === "i32");
    assert(condExpr.operator === "<");
    assert(condExpr.right.value === 10);

    const updateExpr = forStmt.updateExpr.expression;
    assert(updateExpr instanceof AssignmentExpression);
    assert(updateExpr.left instanceof Identifier);
    assert(updateExpr.value instanceof InfixExpression);
    assert(updateExpr.value.left instanceof Identifier);
    assert(updateExpr.value.right instanceof IntegerLiteralExpression);
    assert(updateExpr.left.tokenLiteral() === "i");
    assert(updateExpr.left.typeAnnotation === "i32");
    assert(updateExpr.value.left.tokenLiteral() === "i");
    assert(updateExpr.value.left.typeAnnotation === "i32");
    assert(updateExpr.value.operator === "+");
    assert(updateExpr.value.right.value === 1);

    const ifStmt = forStmt.loopBody.statements[0];
    assert(ifStmt instanceof IfStatement);
    assert(!ifStmt.elseBlock);
    assert(ifStmt.thenBlock.statements.length == 1);

    const ifCond = ifStmt.conditionExpr;
    assert(ifCond instanceof InfixExpression);
    assert(ifCond.left instanceof Identifier);
    assert(ifCond.operator === ">");
    assert(ifCond.right instanceof IntegerLiteralExpression);
    assert(ifCond.left.tokenLiteral() === "i");
    assert(ifCond.right.value === 7);

    const ifRetStmt = ifStmt.thenBlock.statements[0];
    assert(ifRetStmt instanceof ReturnStatement);
    assert(ifRetStmt.returnValue instanceof Identifier);
    assert(ifRetStmt.returnValue.tokenLiteral() === "i");
    assert(ifRetStmt.returnValue.typeAnnotation === "i32");

    const retStmt = funcStmt.fnExpr.body.statements[1];
    assert(retStmt instanceof ReturnStatement);
    assert(retStmt.returnValue instanceof IntegerLiteralExpression);
    assert(retStmt.returnValue.value === 0);
  });

  test("can parse a for loop with a break", () => {
    const p = new Parser(`fn for_for_5(): i32 {
      for (let i: i32 = 0; i < 10; i = i + 1) {
        if (i > 7) {
          break;
        }
      }
      return 0;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    if (!assertFunctionSignature(funcStmt, "for_for_5", [], "i32", 2, false)) {
      return;
    }

    const forStmt = funcStmt.fnExpr.body.statements[0];
    assert(forStmt instanceof ForStatement);
    assert(forStmt.loopBody.statements.length === 1);

    const initBlock = forStmt.initBlock;
    assert(!initBlock.exported);
    assert(initBlock.identifier.tokenLiteral() === "i");
    assert(initBlock.identifier.typeAnnotation === "i32");
    assert(initBlock.expression instanceof IntegerLiteralExpression);
    assert(initBlock.expression.value === 0);

    const condExpr = forStmt.conditionExpr.expression;
    assert(condExpr instanceof InfixExpression);
    assert(condExpr.left instanceof Identifier);
    assert(condExpr.right instanceof IntegerLiteralExpression);
    assert(condExpr.left.tokenLiteral() === "i");
    assert(condExpr.left.typeAnnotation === "i32");
    assert(condExpr.operator === "<");
    assert(condExpr.right.value === 10);

    const updateExpr = forStmt.updateExpr.expression;
    assert(updateExpr instanceof AssignmentExpression);
    assert(updateExpr.left instanceof Identifier);
    assert(updateExpr.value instanceof InfixExpression);
    assert(updateExpr.value.left instanceof Identifier);
    assert(updateExpr.value.right instanceof IntegerLiteralExpression);
    assert(updateExpr.left.tokenLiteral() === "i");
    assert(updateExpr.left.typeAnnotation === "i32");
    assert(updateExpr.value.left.tokenLiteral() === "i");
    assert(updateExpr.value.left.typeAnnotation === "i32");
    assert(updateExpr.value.operator === "+");
    assert(updateExpr.value.right.value === 1);

    const ifStmt = forStmt.loopBody.statements[0];
    assert(ifStmt instanceof IfStatement);
    assert(!ifStmt.elseBlock);
    assert(ifStmt.thenBlock.statements.length == 1);

    const ifCond = ifStmt.conditionExpr;
    assert(ifCond instanceof InfixExpression);
    assert(ifCond.left instanceof Identifier);
    assert(ifCond.operator === ">");
    assert(ifCond.right instanceof IntegerLiteralExpression);
    assert(ifCond.left.tokenLiteral() === "i");
    assert(ifCond.right.value === 7);

    const ifBreakStmt = ifStmt.thenBlock.statements[0];
    assert(ifBreakStmt instanceof BreakStatement);

    const retStmt = funcStmt.fnExpr.body.statements[1];
    assert(retStmt instanceof ReturnStatement);
    assert(retStmt.returnValue instanceof IntegerLiteralExpression);
    assert(retStmt.returnValue.value === 0);
  });

  test("can parse a while loop", () => {
    const p = new Parser(`fn while_loop_1(): void {
      let i: i32 = 0;
      while (i < 10) {
        i = i + 1;
      }
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    if (
      !assertFunctionSignature(funcStmt, "while_loop_1", [], null, 2, false)
    ) {
      return;
    }

    const letStmt = funcStmt.fnExpr.body.statements[0];
    assert(letStmt instanceof LetStatement);
    assert(!letStmt.exported);
    assert(letStmt.identifier.tokenLiteral() === "i");
    assert(letStmt.identifier.typeAnnotation === "i32");
    assert(letStmt.expression instanceof IntegerLiteralExpression);
    assert(letStmt.expression.value === 0);

    const whileStmt = funcStmt.fnExpr.body.statements[1];
    assert(whileStmt instanceof WhileStatement);

    const condExpr = whileStmt.condExpr;
    assert(condExpr instanceof InfixExpression);
    assert(condExpr.left instanceof Identifier);
    assert(condExpr.right instanceof IntegerLiteralExpression);
    assert(condExpr.left.tokenLiteral() === "i");
    assert(condExpr.left.typeAnnotation === "i32");
    assert(condExpr.operator === "<");
    assert(condExpr.right.value === 10);

    assert(whileStmt.loopBody.statements.length === 1);
    const updateStmt = whileStmt.loopBody.statements[0];
    assert(updateStmt instanceof ExpressionStatement);
    const updateExpr = updateStmt.expression;
    assert(updateExpr instanceof AssignmentExpression);
    assert(updateExpr.left instanceof Identifier);
    assert(updateExpr.value instanceof InfixExpression);
    assert(updateExpr.value.left instanceof Identifier);
    assert(updateExpr.value.right instanceof IntegerLiteralExpression);
    assert(updateExpr.left.tokenLiteral() === "i");
    assert(updateExpr.left.typeAnnotation === "i32");
    assert(updateExpr.value.left.tokenLiteral() === "i");
    assert(updateExpr.value.left.typeAnnotation === "i32");
    assert(updateExpr.value.operator === "+");
    assert(updateExpr.value.right.value === 1);
  });

  test("can parse a while loop with a return", () => {
    const p = new Parser(`fn while_loop_2(): void {
      let i: i32 = 0;
      while (i < 10) {
        if (i > 7) {
          return i;
        }
        i = i + 1;
      }
      return i;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    if (
      !assertFunctionSignature(funcStmt, "while_loop_2", [], null, 3, false)
    ) {
      return;
    }

    const letStmt = funcStmt.fnExpr.body.statements[0];
    assert(letStmt instanceof LetStatement);
    assert(!letStmt.exported);
    assert(letStmt.identifier.tokenLiteral() === "i");
    assert(letStmt.identifier.typeAnnotation === "i32");
    assert(letStmt.expression instanceof IntegerLiteralExpression);
    assert(letStmt.expression.value === 0);

    const whileStmt = funcStmt.fnExpr.body.statements[1];
    assert(whileStmt instanceof WhileStatement);
    assert(whileStmt.loopBody.statements.length === 2);

    const condExpr = whileStmt.condExpr;
    assert(condExpr instanceof InfixExpression);
    assert(condExpr.left instanceof Identifier);
    assert(condExpr.right instanceof IntegerLiteralExpression);
    assert(condExpr.left.tokenLiteral() === "i");
    assert(condExpr.left.typeAnnotation === "i32");
    assert(condExpr.operator === "<");
    assert(condExpr.right.value === 10);

    const ifStmt = whileStmt.loopBody.statements[0];
    assert(ifStmt instanceof IfStatement);
    assert(!ifStmt.elseBlock);
    assert(ifStmt.thenBlock.statements.length == 1);

    const ifCond = ifStmt.conditionExpr;
    assert(ifCond instanceof InfixExpression);
    assert(ifCond.left instanceof Identifier);
    assert(ifCond.operator === ">");
    assert(ifCond.right instanceof IntegerLiteralExpression);
    assert(ifCond.left.tokenLiteral() === "i");
    assert(ifCond.right.value === 7);

    const ifRetStmt = ifStmt.thenBlock.statements[0];
    assert(ifRetStmt instanceof ReturnStatement);
    assert(ifRetStmt.returnValue instanceof Identifier);
    assert(ifRetStmt.returnValue.tokenLiteral() === "i");
    assert(ifRetStmt.returnValue.typeAnnotation === "i32");

    const updateStmt = whileStmt.loopBody.statements[1];
    assert(updateStmt instanceof ExpressionStatement);
    const updateExpr = updateStmt.expression;
    assert(updateExpr instanceof AssignmentExpression);
    assert(updateExpr.left instanceof Identifier);
    assert(updateExpr.value instanceof InfixExpression);
    assert(updateExpr.value.left instanceof Identifier);
    assert(updateExpr.value.right instanceof IntegerLiteralExpression);
    assert(updateExpr.left.tokenLiteral() === "i");
    assert(updateExpr.left.typeAnnotation === "i32");
    assert(updateExpr.value.left.tokenLiteral() === "i");
    assert(updateExpr.value.left.typeAnnotation === "i32");
    assert(updateExpr.value.operator === "+");
    assert(updateExpr.value.right.value === 1);

    const retStmt = funcStmt.fnExpr.body.statements[2];
    assert(retStmt instanceof ReturnStatement);
    assert(retStmt.returnValue instanceof Identifier);
    assert(retStmt.returnValue.tokenLiteral() === "i");
    assert(retStmt.returnValue.typeAnnotation === "i32");
  });

  test("can parse a while loop with a break", () => {
    const p = new Parser(`fn while_loop_3(): i32 {
      let i: i32 = 0;
      while (i < 10) {
        if (i > 9) {
          break;
        }
        i = i + 1;
      }
      return i;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    if (
      !assertFunctionSignature(funcStmt, "while_loop_3", [], "i32", 3, false)
    ) {
      return;
    }

    const letStmt = funcStmt.fnExpr.body.statements[0];
    assert(letStmt instanceof LetStatement);
    assert(!letStmt.exported);
    assert(letStmt.identifier.tokenLiteral() === "i");
    assert(letStmt.identifier.typeAnnotation === "i32");
    assert(letStmt.expression instanceof IntegerLiteralExpression);
    assert(letStmt.expression.value === 0);

    const whileStmt = funcStmt.fnExpr.body.statements[1];
    assert(whileStmt instanceof WhileStatement);
    assert(whileStmt.loopBody.statements.length === 2);

    const condExpr = whileStmt.condExpr;
    assert(condExpr instanceof InfixExpression);
    assert(condExpr.left instanceof Identifier);
    assert(condExpr.right instanceof IntegerLiteralExpression);
    assert(condExpr.left.tokenLiteral() === "i");
    assert(condExpr.left.typeAnnotation === "i32");
    assert(condExpr.operator === "<");
    assert(condExpr.right.value === 10);

    const ifStmt = whileStmt.loopBody.statements[0];
    assert(ifStmt instanceof IfStatement);
    assert(!ifStmt.elseBlock);
    assert(ifStmt.thenBlock.statements.length == 1);

    const ifCond = ifStmt.conditionExpr;
    assert(ifCond instanceof InfixExpression);
    assert(ifCond.left instanceof Identifier);
    assert(ifCond.operator === ">");
    assert(ifCond.right instanceof IntegerLiteralExpression);
    assert(ifCond.left.tokenLiteral() === "i");
    assert(ifCond.right.value === 9);

    const ifRetStmt = ifStmt.thenBlock.statements[0];
    assert(ifRetStmt instanceof BreakStatement);

    const updateStmt = whileStmt.loopBody.statements[1];
    assert(updateStmt instanceof ExpressionStatement);
    const updateExpr = updateStmt.expression;
    assert(updateExpr instanceof AssignmentExpression);
    assert(updateExpr.left instanceof Identifier);
    assert(updateExpr.value instanceof InfixExpression);
    assert(updateExpr.value.left instanceof Identifier);
    assert(updateExpr.value.right instanceof IntegerLiteralExpression);
    assert(updateExpr.left.tokenLiteral() === "i");
    assert(updateExpr.left.typeAnnotation === "i32");
    assert(updateExpr.value.left.tokenLiteral() === "i");
    assert(updateExpr.value.left.typeAnnotation === "i32");
    assert(updateExpr.value.operator === "+");
    assert(updateExpr.value.right.value === 1);

    const retStmt = funcStmt.fnExpr.body.statements[2];
    assert(retStmt instanceof ReturnStatement);
    assert(retStmt.returnValue instanceof Identifier);
    assert(retStmt.returnValue.tokenLiteral() === "i");
    assert(retStmt.returnValue.typeAnnotation === "i32");
  });
});

//
//  @TODO:
//
//    Compare:
//        >=, <=,
//
//    Bitwise:
//      >>, <<,
//
//    Assignment:
//    +=, -=, *=, /=, %=, |=, &=, ^=, >>=, <<=
//
//
describe("Parser: Operators", () => {
  describe("Infix", () => {
    test("infix addition: literal + literal", () => {
      const p = new Parser(`fn infix_add(): i32 {
        return 10 + 15;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(funcStmt, "infix_add", [], "i32", 1, false)
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof IntegerLiteralExpression);
      assert(right instanceof IntegerLiteralExpression);
      assert(operator === "+");
    });

    test("infix addition: identifier + literal", () => {
      const p = new Parser(`fn infix_add(n: i32): i32 {
        return n + 15;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "infix_add",
          [["n", "i32"]],
          "i32",
          1,
          false
        )
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof Identifier);
      assert(left.tokenLiteral() === "n");
      assert(left.typeAnnotation === "i32");
      assert(right instanceof IntegerLiteralExpression);
      assert(operator === "+");
    });

    test("infix subtraction: literal - literal", () => {
      const p = new Parser(`fn infix_sub(): i32 {
        return 10 - 15;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(funcStmt, "infix_sub", [], "i32", 1, false)
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof IntegerLiteralExpression);
      assert(right instanceof IntegerLiteralExpression);
      assert(operator === "-");
    });

    test("infix subtraction: identifier - literal", () => {
      const p = new Parser(`fn infix_sub(n: i32): i32 {
        return n - 15;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "infix_sub",
          [["n", "i32"]],
          "i32",
          1,
          false
        )
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof Identifier);
      assert(left.tokenLiteral() === "n");
      assert(left.typeAnnotation === "i32");
      assert(right instanceof IntegerLiteralExpression);
      assert(operator === "-");
    });

    test("infix multiplication: literal * literal", () => {
      const p = new Parser(`fn infix_mul(): i32 {
        return 10 * 15;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(funcStmt, "infix_mul", [], "i32", 1, false)
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof IntegerLiteralExpression);
      assert(right instanceof IntegerLiteralExpression);
      assert(operator === "*");
    });

    test("infix multiplication: identifier * literal", () => {
      const p = new Parser(`fn infix_mul(n: i32): i32 {
        return n * 15;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "infix_mul",
          [["n", "i32"]],
          "i32",
          1,
          false
        )
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof Identifier);
      assert(left.tokenLiteral() === "n");
      assert(left.typeAnnotation === "i32");
      assert(right instanceof IntegerLiteralExpression);
      assert(operator === "*");
    });

    test("infix division: literal / literal", () => {
      const p = new Parser(`fn infix_div(): i32 {
        return 10 / 15;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(funcStmt, "infix_div", [], "i32", 1, false)
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof IntegerLiteralExpression);
      assert(right instanceof IntegerLiteralExpression);
      assert(operator === "/");
    });

    test("infix division: identifier / literal", () => {
      const p = new Parser(`fn infix_div(n: i32): i32 {
        return n / 15;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "infix_div",
          [["n", "i32"]],
          "i32",
          1,
          false
        )
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof Identifier);
      assert(left.tokenLiteral() === "n");
      assert(left.typeAnnotation === "i32");
      assert(right instanceof IntegerLiteralExpression);
      assert(operator === "/");
    });

    test("infix modulo: literal % literal", () => {
      const p = new Parser(`fn infix_mod(): i32 {
        return 10 % 15;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(funcStmt, "infix_mod", [], "i32", 1, false)
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof IntegerLiteralExpression);
      assert(right instanceof IntegerLiteralExpression);
      assert(operator === "%");
    });

    test("infix modulo: identifier % literal", () => {
      const p = new Parser(`fn infix_mod(n: i32): i32 {
        return n % 15;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "infix_mod",
          [["n", "i32"]],
          "i32",
          1,
          false
        )
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof Identifier);
      assert(left.tokenLiteral() === "n");
      assert(left.typeAnnotation === "i32");
      assert(right instanceof IntegerLiteralExpression);
      assert(operator === "%");
    });

    test("infix logic and: literal && literal", () => {
      const p = new Parser(`fn infix_logic_and(): bool {
        return true && false;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "infix_logic_and",
          [],
          "bool",
          1,
          false
        )
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof BooleanLiteralExpression);
      assert(right instanceof BooleanLiteralExpression);
      assert(left.value === true);
      assert(operator === "&&");
      assert(right.value === false);
    });

    test("infix logic or: literal || literal", () => {
      const p = new Parser(`fn infix_logic_or(): bool {
        return true || false;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "infix_logic_or",
          [],
          "bool",
          1,
          false
        )
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof BooleanLiteralExpression);
      assert(right instanceof BooleanLiteralExpression);
      assert(left.value === true);
      assert(operator === "||");
      assert(right.value === false);
    });

    test("infix logic equals: literal == literal", () => {
      const p = new Parser(`fn infix_logic_eq(): bool {
        return true == false;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "infix_logic_eq",
          [],
          "bool",
          1,
          false
        )
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof BooleanLiteralExpression);
      assert(right instanceof BooleanLiteralExpression);
      assert(left.value === true);
      assert(operator === "==");
      assert(right.value === false);
    });

    test("infix bitwise and: literal & literal", () => {
      const p = new Parser(`fn infix_bitwise_and(): i32 {
        return 44 & 37;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "infix_bitwise_and",
          [],
          "i32",
          1,
          false
        )
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof IntegerLiteralExpression);
      assert(right instanceof IntegerLiteralExpression);
      assert(left.value === 44);
      assert(operator === "&");
      assert(right.value === 37);
    });

    test("infix bitwise or: literal | literal", () => {
      const p = new Parser(`fn infix_bitwise_or(): i32 {
        return 44 | 37;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "infix_bitwise_or",
          [],
          "i32",
          1,
          false
        )
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof IntegerLiteralExpression);
      assert(right instanceof IntegerLiteralExpression);
      assert(left.value === 44);
      assert(operator === "|");
      assert(right.value === 37);
    });

    test("infix bitwise xor: literal ^ literal", () => {
      const p = new Parser(`fn infix_bitwise_xor(): i32 {
        return 44 ^ 37;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "infix_bitwise_xor",
          [],
          "i32",
          1,
          false
        )
      ) {
        return;
      }

      const infixStmt = funcStmt.fnExpr.body.statements[0];
      assert(infixStmt instanceof ReturnStatement);
      const infixExpr = infixStmt.returnValue;
      assert(infixExpr instanceof InfixExpression);
      const { left, right, operator } = infixExpr;
      assert(left instanceof IntegerLiteralExpression);
      assert(right instanceof IntegerLiteralExpression);
      assert(left.value === 44);
      assert(operator === "^");
      assert(right.value === 37);
    });
  });

  describe("Prefix", () => {
    test("prefix negative - literal", () => {
      const p = new Parser(`fn prefix_neg(): i32 {
      return -10;
    }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(funcStmt, "prefix_neg", [], "i32", 1, false)
      ) {
        return;
      }

      const prefixStmt = funcStmt.fnExpr.body.statements[0];
      assert(prefixStmt instanceof ReturnStatement);
      const prefixExpr = prefixStmt.returnValue;
      assert(prefixExpr instanceof PrefixExpression);
      const { right, operator } = prefixExpr;
      assert(right instanceof IntegerLiteralExpression);
      assert(operator === "-");
      assert(right.value === 10);
    });

    test("prefix negative - identifier", () => {
      const p = new Parser(`fn prefix_neg(n: i32): i32 {
      return -n;
    }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "prefix_neg",
          [["n", "i32"]],
          "i32",
          1,
          false
        )
      ) {
        return;
      }

      const prefixStmt = funcStmt.fnExpr.body.statements[0];
      assert(prefixStmt instanceof ReturnStatement);
      const prefixExpr = prefixStmt.returnValue;
      assert(prefixExpr instanceof PrefixExpression);
      const { right, operator } = prefixExpr;
      assert(right instanceof Identifier);
      assert(operator === "-");
      assert(right.tokenLiteral() === "n");
      assert(right.typeAnnotation === "i32");
    });

    test("prefix bitwise not - literal", () => {
      const p = new Parser(`fn prefix_not(): i32 {
      return ~10;
    }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(funcStmt, "prefix_not", [], "i32", 1, false)
      ) {
        return;
      }

      const prefixStmt = funcStmt.fnExpr.body.statements[0];
      assert(prefixStmt instanceof ReturnStatement);
      const prefixExpr = prefixStmt.returnValue;
      assert(prefixExpr instanceof PrefixExpression);
      const { right, operator } = prefixExpr;
      assert(right instanceof IntegerLiteralExpression);
      assert(operator === "~");
      assert(right.value === 10);
    });

    test("prefix bitwise not - identifier", () => {
      const p = new Parser(`fn prefix_not(n: i32): i32 {
      return ~n;
    }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "prefix_not",
          [["n", "i32"]],
          "i32",
          1,
          false
        )
      ) {
        return;
      }

      const prefixStmt = funcStmt.fnExpr.body.statements[0];
      assert(prefixStmt instanceof ReturnStatement);
      const prefixExpr = prefixStmt.returnValue;
      assert(prefixExpr instanceof PrefixExpression);
      const { right, operator } = prefixExpr;
      assert(right instanceof Identifier);
      assert(operator === "~");
      assert(right.tokenLiteral() === "n");
      assert(right.typeAnnotation === "i32");
    });

    test("prefix logical not - literal", () => {
      const p = new Parser(`fn prefix_logical_not(): bool {
      return !true;
    }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "prefix_logical_not",
          [],
          "bool",
          1,
          false
        )
      ) {
        return;
      }

      const prefixStmt = funcStmt.fnExpr.body.statements[0];
      assert(prefixStmt instanceof ReturnStatement);
      const prefixExpr = prefixStmt.returnValue;
      assert(prefixExpr instanceof PrefixExpression);
      const { right, operator } = prefixExpr;
      assert(right instanceof BooleanLiteralExpression);
      assert(operator === "!");
      assert(right.value === true);
    });

    test("prefix logical not - identifier", () => {
      const p = new Parser(`fn prefix_logical_not(b: bool): bool {
      return !b;
    }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "prefix_logical_not",
          [["b", "bool"]],
          "bool",
          1,
          false
        )
      ) {
        return;
      }

      const prefixStmt = funcStmt.fnExpr.body.statements[0];
      assert(prefixStmt instanceof ReturnStatement);
      const prefixExpr = prefixStmt.returnValue;
      assert(prefixExpr instanceof PrefixExpression);
      const { right, operator } = prefixExpr;
      assert(right instanceof Identifier);
      assert(operator === "!");
      assert(right.tokenLiteral() === "b");
      assert(right.typeAnnotation === "bool");
    });
  });

  describe("Postfix", () => {
    test("postfix increment", () => {
      const p = new Parser(`fn post_inc(n: i32): i32 {
      return n++;
    }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "post_inc",
          [["n", "i32"]],
          "i32",
          1,
          false
        )
      ) {
        return;
      }

      const retStmt = funcStmt.fnExpr.body.statements[0];
      assert(retStmt instanceof ReturnStatement);
      const postStmt = retStmt.returnValue;
      assert(postStmt instanceof PostfixExpression);
      assert(postStmt.left instanceof Identifier);
      assert(postStmt.left.tokenLiteral() === "n");
      assert(postStmt.left.typeAnnotation === "i32");
      assert(postStmt.operator === "++");
    });

    test("postfix decrement", () => {
      const p = new Parser(`fn post_dec(n: i32): i32 {
      return n--;
    }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (
        !assertFunctionSignature(
          funcStmt,
          "post_dec",
          [["n", "i32"]],
          "i32",
          1,
          false
        )
      ) {
        return;
      }

      const retStmt = funcStmt.fnExpr.body.statements[0];
      assert(retStmt instanceof ReturnStatement);
      const postStmt = retStmt.returnValue;
      assert(postStmt instanceof PostfixExpression);
      assert(postStmt.left instanceof Identifier);
      assert(postStmt.left.tokenLiteral() === "n");
      assert(postStmt.left.typeAnnotation === "i32");
      assert(postStmt.operator === "--");
    });
  });
});

describe("Parser: Struct Access", () => {
  const struct_def = `
struct T {
  a: i32,
  b: f32,
  c: bool
}
let t: T = {
  a = 10,
  b = 3.14,
  c = false
};`;

  test("struct member access", () => {
    const p = new Parser(`${struct_def}
    fn member_access(): i32 {
      return t.a;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 3);
    const funcStmt = ast.statements[2];
    if (
      !assertFunctionSignature(funcStmt, "member_access", [], "i32", 1, false)
    ) {
      return;
    }

    const retStmt = funcStmt.fnExpr.body.statements[0];
    assert(retStmt instanceof ReturnStatement);
    const memberExpr = retStmt.returnValue;
    assert(memberExpr instanceof MemberExpression);
    assert(memberExpr.parent instanceof Identifier);
    assert(memberExpr.parent.tokenLiteral() === "t");
    assert(memberExpr.member === "a");
  });

  test("struct member assign", () => {
    const p = new Parser(`${struct_def}
    fn member_access(): i32 {
      t.a = 14;
      return t.a;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 3);
    const funcStmt = ast.statements[2];
    if (
      !assertFunctionSignature(funcStmt, "member_access", [], "i32", 2, false)
    ) {
      return;
    }

    const updateStmt = funcStmt.fnExpr.body.statements[0];
    assert(updateStmt instanceof ExpressionStatement);
    assert(updateStmt.expression instanceof AssignmentExpression);
    assert(updateStmt.expression.left instanceof MemberExpression);
    assert(updateStmt.expression.value instanceof IntegerLiteralExpression);
    assert(updateStmt.expression.left.parent instanceof Identifier);
    assert(updateStmt.expression.left.member === "a");
    assert(updateStmt.expression.left.parent.typeAnnotation === "T");
    assert(updateStmt.expression.left.parent.tokenLiteral() === "t");
    assert(updateStmt.expression.value.value === 14);

    const retStmt = funcStmt.fnExpr.body.statements[1];
    assert(retStmt instanceof ReturnStatement);
    const memberExpr = retStmt.returnValue;
    assert(memberExpr instanceof MemberExpression);
    assert(memberExpr.parent instanceof Identifier);
    assert(memberExpr.parent.tokenLiteral() === "t");
    assert(memberExpr.parent.typeAnnotation === "T");
    assert(memberExpr.member === "a");
  });
});

describe.skip("Parser: Array Access", () => {
  const array_def = `let arr: i32[] = [1,2,3,4,5,6];`;

  // let arr: i32[] = [...];
  test("can parse array literal", () => {
    const p = new Parser(array_def);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
  });

  // let x: i32 = arr[3];
  test("can parse array access: literal", () => {
    const p = new Parser(`${array_def}
fn test_arr(): void {
  let x: i32 = arr[3];
}
`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
  });

  // let x: i32 = 3;
  // let z: i32 = arr[x];
  test("can parse array access: variable", () => {
    const p = new Parser(`${array_def}
fn test_arr(): void {
  let x: i32 = 3;
  let z: i32 = arr[x];
}
`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
  });

  // let x: i32 = 2;
  // let y: i32 = 1;
  // let z: i32 = arr[x + y];
  test("can parse array access: infix expression", () => {
    const p = new Parser(`${array_def}
fn test_arr(): void {
  let x: i32 = 2;
  let y: i32 = 1;
  let z: i32 = arr[x + y];
}
`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
  });

  // let x: i32 = 3;
  // let z: i32 = arr[x++];
  test("can parse array access: postfix expression", () => {
    const p = new Parser(`${array_def}
fn test_arr(): void {
  let x: i32 = 3;
  let z: i32 = arr[x++];
}
`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
  });

  // fn test(): i32 { return 3; }
  // let z: i32 = arr[test()];
  test("can parse array access: function call", () => {
    const p = new Parser(`${array_def}
fn test(): i32 { return 3; }

fn test_arr(): void {
  let z: i32 = arr[test()];
}
`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
  });
});

/// Utils

const EPSILON = 0.00001;
function floatEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

function assertStructStatement(
  structStmt: ASTStatement,
  name: string,
  members: Record<string, StructMember>
): structStmt is StructStatement {
  assert(structStmt instanceof StructStatement);
  assert(structStmt.name === name);
  assert(
    Object.keys(structStmt.members).length === Object.keys(members).length
  );

  for (const [key, data] of Object.entries(members)) {
    assert(
      !!structStmt.members[key],
      `Struct: "${name}" expected member does not exist: "${key}"`
    );
    assert(structStmt.members[key].name === data.name);
    assert(
      structStmt.members[key].offset === data.offset,
      `Struct: "${name}" member: "${data.name}" incorrect offset. Expected: "${data.offset}", Got: "${structStmt.members[key].offset}"`
    );
    assert(
      structStmt.members[key].size === data.size,
      `Struct: "${name}" member: "${data.name}" incorrect size. Expected: "${data.size}", Got: "${structStmt.members[key].size}"`
    );
    assert(
      structStmt.members[key].type === data.type,
      `Struct: "${name}" member: "${data.name}" incorrect type. Expected: "${data.type}", Got: "${structStmt.members[key].type}"`
    );
  }

  return true;
}

function assertFunctionSignature(
  funcStmt: ASTStatement,
  name: string,
  params: Array<[string, string]>,
  returnType: string | null,
  bodyLength: number,
  exported: boolean
): funcStmt is FunctionStatement {
  assert(funcStmt instanceof FunctionStatement);
  assert(funcStmt.name === name);
  assert(funcStmt.fnExpr.params.length === params.length);
  assert(funcStmt.fnExpr.returnType === returnType);
  assert(funcStmt.fnExpr.body.statements.length === bodyLength);
  assert(funcStmt.exported === exported);
  assertFunctionParams(funcStmt, params);
  return true;
}

// params: Array<[name, type]>
function assertFunctionParams(
  funcStmt: FunctionStatement,
  expectedParams: Array<[string, string]>
): void {
  const params = funcStmt.fnExpr.params;
  assert(expectedParams.length === params.length);
  for (let i = 0; i < params.length; i = i + 1) {
    const p = params[i];
    const lit = p.identifier.tokenLiteral();
    const type = p.type;
    const [expectedLit, expectedType] = expectedParams[i];
    assert(lit === expectedLit);
    assert(type === expectedType);
  }
}
