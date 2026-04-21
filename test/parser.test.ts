import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StructMember } from "../src/compiler/emitters/emitter.types";
import { Tokenizer } from "../src/lexer/Tokenizer";
import { ArrayLiteralExpression } from "../src/parser/ast/expressions/ArrayLiteralExpression";
import { AssignmentExpression } from "../src/parser/ast/expressions/AssignmentExpression";
import { BooleanLiteralExpression } from "../src/parser/ast/expressions/BooleanLiteralExpression";
import { CallExpression } from "../src/parser/ast/expressions/CallExpression";
import { CastExpression } from "../src/parser/ast/expressions/CastExpression";
import { FloatLiteralExpression } from "../src/parser/ast/expressions/FloatLiteralExpression";
import { FunctionLiteralExpression } from "../src/parser/ast/expressions/FunctionLiteralExpression";
import { Identifier } from "../src/parser/ast/expressions/Identifier";
import { InfixExpression } from "../src/parser/ast/expressions/InfixExpression";
import { IntegerLiteralExpression } from "../src/parser/ast/expressions/IntegerLiteral";
import { MemberExpression } from "../src/parser/ast/expressions/MemberExpression";
import { PostfixExpression } from "../src/parser/ast/expressions/PostfixExpression";
import { PrefixExpression } from "../src/parser/ast/expressions/PrefixExpression";
import { StringLiteralExpression } from "../src/parser/ast/expressions/StringLiteral";
import { StructLiteralExpression } from "../src/parser/ast/expressions/StructLiteralExpression";
import { BreakStatement } from "../src/parser/ast/statements/BreakStatement";
import { ContinueStatement } from "../src/parser/ast/statements/ContinueStatement";
import { ExpressionStatement } from "../src/parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../src/parser/ast/statements/ForStatement";
import { FunctionStatement } from "../src/parser/ast/statements/FunctionStatement";
import { IfStatement } from "../src/parser/ast/statements/IfStatement";
import { ImportStatement } from "../src/parser/ast/statements/ImportStatement";
import { LetStatement } from "../src/parser/ast/statements/LetStatement";
import { ReturnStatement } from "../src/parser/ast/statements/ReturnStatement";
import { StructStatement } from "../src/parser/ast/statements/StructStatement";
import { SwitchStatement } from "../src/parser/ast/statements/SwitchStatement";
import { TuplePattern } from "../src/parser/ast/statements/TuplePattern";
import { WhileStatement } from "../src/parser/ast/statements/WhileStatement";
import type { ASTStatement } from "../src/parser/ast/types/ast.type";
import { Parser } from "../src/parser/Parser";

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
    assertFunctionSignature(ast.statements[0], "test_bool", [], "bool", 0, false);
  });

  test("can parse a function that returns a struct", () => {
    const p = new Parser("fn test_struct(): Color {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    assertFunctionSignature(ast.statements[0], "test_struct", [], "Color", 0, false);
  });

  test("can parse a function that returns an array", () => {
    const p = new Parser("fn test_arr(): i32[] {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    assertFunctionSignature(ast.statements[0], "test_arr", [], "i32[]", 0, false);
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
    const p = new Parser("fn multi_func(a: i32, b: f32, c: Color, d: bool): i32 {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const params: [string, string][] = [
      ["a", "i32"],
      ["b", "f32"],
      ["c", "Color"],
      ["d", "bool"],
    ];
    assertFunctionSignature(ast.statements[0], "multi_func", params, "i32", 0, false);
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
    if (!assertFunctionSignature(funcStmt, "func_ret", params, "i32", 1, false)) {
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
      _flag: { name: "_flag", offset: 8, size: 4, type: "bool" },
    });

    const letStmt = ast.statements[1];
    assert(letStmt instanceof LetStatement);
    assert(letStmt.identifier.tokenLiteral() === "t");
    assert(
      letStmt.identifier.typeAnnotation === "T",
      `Expected type: "T", Got: "${letStmt.identifier.typeAnnotation}`,
    );
    const structLit = letStmt.expression;
    assert(structLit instanceof StructLiteralExpression);
    assert(structLit.name === "T");
    assert(Object.keys(structLit.members).length === 3);
    assert(!!structLit.members.apple);
    assert(!!structLit.members.banana);
    assert(!!structLit.members._flag);
    const appleExpr = structLit.members.apple;
    const banExpr = structLit.members.banana;
    const flagExpr = structLit.members._flag;
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
    assert(!!structLit.members.len);
    assert(!!structLit.members.next);
    const lenExpr = structLit.members.len;
    const nextExpr = structLit.members.next;
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
    if (!assertFunctionSignature(funcStmt, "test_assign_i32", [], "i32", 3, false)) {
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
    if (!assertFunctionSignature(funcStmt, "test_assign_f32", [], "f32", 3, false)) {
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
    // biome-ignore lint/suspicious/noApproximativeNumericConstant: intentional literal, not Math.PI
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
    if (!assertFunctionSignature(funcStmt, "test_assign_bool", [], "bool", 3, false)) {
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

  test("can parse compound assignment operators", () => {
    const p = new Parser(`fn test_compound_assign(x: i32): i32 {
      x += 2;
      x -= 1;
      x *= 3;
      x /= 2;
      x %= 5;
      x |= 4;
      x &= 7;
      x ^= 1;
      x <<= 2;
      x >>= 1;
      return x;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    if (
      !assertFunctionSignature(funcStmt, "test_compound_assign", [["x", "i32"]], "i32", 11, false)
    ) {
      return;
    }

    const expectedOperators = ["+=", "-=", "*=", "/=", "%=", "|=", "&=", "^=", "<<=", ">>="];
    for (let i = 0; i < expectedOperators.length; i = i + 1) {
      const stmt = funcStmt.fnExpr.body.statements[i];
      assert(stmt instanceof ExpressionStatement);
      assert(stmt.expression instanceof AssignmentExpression);
      assert(stmt.expression.left instanceof Identifier);
      assert(stmt.expression.left.tokenLiteral() === "x");
      assert(stmt.expression.operator === expectedOperators[i]);
      assert(stmt.expression.value instanceof IntegerLiteralExpression);
    }
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
    if (!assertFunctionSignature(funcStmt, "test_if_1", params, "i32", 3, false)) {
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
    if (!assertFunctionSignature(funcStmt, "test_if_2", params, "i32", 2, false)) {
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
    if (!assertFunctionSignature(funcStmt, "test_if_3", params, "i32", 3, false)) {
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
    if (!assertFunctionSignature(funcStmt, "test_if_4", params, "i32", 1, false)) {
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
    if (!assertFunctionSignature(funcStmt, "test_if_5", params, "i32", 1, false)) {
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
    if (!assertFunctionSignature(funcStmt, "test_if_6", params, "i32", 1, false)) {
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
    assert(ifStmt.thenBlock.statements.length === 1);

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
    assert(ifStmt.thenBlock.statements.length === 1);

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
    if (!assertFunctionSignature(funcStmt, "while_loop_1", [], null, 2, false)) {
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
    if (!assertFunctionSignature(funcStmt, "while_loop_2", [], null, 3, false)) {
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
    assert(ifStmt.thenBlock.statements.length === 1);

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

  test("can parse bare return statement", () => {
    const p = new Parser(`fn do_thing(): void {
      return;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    if (!assertFunctionSignature(funcStmt, "do_thing", [], null, 1, false)) {
      return;
    }
    const ret = funcStmt.fnExpr.body.statements[0];
    assert(ret instanceof ReturnStatement);
    assert(ret.returnValue === null);
  });

  test("can parse else if ladder", () => {
    const p = new Parser(`fn grade(score: i32): i32 {
      if (score >= 90) {
        return 5;
      } else if (score >= 75) {
        return 4;
      } else {
        return 3;
      }
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    if (!assertFunctionSignature(funcStmt, "grade", [["score", "i32"]], "i32", 1, false)) {
      return;
    }

    const ifStmt = funcStmt.fnExpr.body.statements[0];
    assert(ifStmt instanceof IfStatement);
    assert(ifStmt.thenBlock.statements[0] instanceof ReturnStatement);

    // elseBlock is itself an IfStatement (not a plain block)
    assert(ifStmt.elseBlock !== undefined);
    assert(ifStmt.elseBlock.statements.length === 1);
    const elseIf = ifStmt.elseBlock.statements[0];
    assert(elseIf instanceof IfStatement);
    assert(elseIf.thenBlock.statements[0] instanceof ReturnStatement);

    // innermost else
    assert(elseIf.elseBlock !== undefined);
    assert(elseIf.elseBlock.statements[0] instanceof ReturnStatement);
  });

  test("can parse continue in a for loop", () => {
    const p = new Parser(`fn test(): void {
      for (let i: i32 = 0; i < 10; i = i + 1) {
        continue;
      }
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    if (!assertFunctionSignature(funcStmt, "test", [], null, 1, false)) {
      return;
    }

    const forStmt = funcStmt.fnExpr.body.statements[0];
    assert(forStmt instanceof ForStatement);
    assert(forStmt.loopBody.statements.length === 1);
    assert(forStmt.loopBody.statements[0] instanceof ContinueStatement);
  });

  test("can parse continue in a while loop", () => {
    const p = new Parser(`fn test(): void {
      let i: i32 = 0;
      while (i < 5) {
        i = i + 1;
        continue;
      }
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    if (!assertFunctionSignature(funcStmt, "test", [], null, 2, false)) {
      return;
    }

    const whileStmt = funcStmt.fnExpr.body.statements[1];
    assert(whileStmt instanceof WhileStatement);
    assert(whileStmt.loopBody.statements.length === 2);
    assert(whileStmt.loopBody.statements[1] instanceof ContinueStatement);
  });

  test("can parse const declaration", () => {
    const p = new Parser(`const MAX: i32 = 100;`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const constStmt = ast.statements[0];
    assert(constStmt instanceof LetStatement);
    assert(constStmt.identifier.tokenLiteral() === "MAX");
    assert(constStmt.identifier.typeAnnotation === "i32");
    assert(constStmt.expression instanceof IntegerLiteralExpression);
    assert(constStmt.expression.value === 100);
    assert(constStmt.mutable === false);
  });

  test("let is mutable by default", () => {
    const p = new Parser(`let x: i32 = 0;`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const letStmt = ast.statements[0];
    assert(letStmt instanceof LetStatement);
    assert(letStmt.mutable === true);
  });

  test("can parse switch statement", () => {
    const p = new Parser(`fn classify(x: i32): i32 {
      switch (x) {
        case 0: { return 10; }
        case 1: { return 20; }
        default: { return 99; }
      }
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    if (!assertFunctionSignature(funcStmt, "classify", [["x", "i32"]], "i32", 1, false)) {
      return;
    }

    const switchStmt = funcStmt.fnExpr.body.statements[0];
    assert(switchStmt instanceof SwitchStatement);
    assert(switchStmt.switchExpr instanceof Identifier);
    assert(switchStmt.switchExpr.tokenLiteral() === "x");
    assert(switchStmt.cases.length === 2);
    assert(switchStmt.cases[0].test === 0);
    assert(switchStmt.cases[1].test === 1);
    assert(switchStmt.default !== undefined);
  });

  test("can parse switch without default", () => {
    const p = new Parser(`fn test(x: i32): void {
      switch (x) {
        case 0: { return; }
        case 1: { return; }
      }
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    if (!assertFunctionSignature(funcStmt, "test", [["x", "i32"]], null, 1, false)) {
      return;
    }

    const switchStmt = funcStmt.fnExpr.body.statements[0];
    assert(switchStmt instanceof SwitchStatement);
    assert(switchStmt.cases.length === 2);
    assert(switchStmt.default === undefined);
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
    if (!assertFunctionSignature(funcStmt, "while_loop_3", [], "i32", 3, false)) {
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
    assert(ifStmt.thenBlock.statements.length === 1);

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
      if (!assertFunctionSignature(funcStmt, "infix_add", [], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_add", [["n", "i32"]], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_sub", [], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_sub", [["n", "i32"]], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_mul", [], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_mul", [["n", "i32"]], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_div", [], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_div", [["n", "i32"]], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_mod", [], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_mod", [["n", "i32"]], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_logic_and", [], "bool", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_logic_or", [], "bool", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_logic_eq", [], "bool", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_bitwise_and", [], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_bitwise_or", [], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "infix_bitwise_xor", [], "i32", 1, false)) {
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

    test("infix less than equals: literal <= literal", () => {
      const p = new Parser(`fn infix_lte(): bool {
        return 10 <= 20;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      const funcStmt = ast.statements[0];
      if (!assertFunctionSignature(funcStmt, "infix_lte", [], "bool", 1, false)) {
        return;
      }
      const infixExpr = (funcStmt.fnExpr.body.statements[0] as ReturnStatement).returnValue;
      assert(infixExpr instanceof InfixExpression);
      assert(infixExpr.operator === "<=");
    });

    test("infix greater than equals: literal >= literal", () => {
      const p = new Parser(`fn infix_gte(): bool {
        return 20 >= 10;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      const funcStmt = ast.statements[0];
      if (!assertFunctionSignature(funcStmt, "infix_gte", [], "bool", 1, false)) {
        return;
      }
      const infixExpr = (funcStmt.fnExpr.body.statements[0] as ReturnStatement).returnValue;
      assert(infixExpr instanceof InfixExpression);
      assert(infixExpr.operator === ">=");
    });

    test("infix left shift: literal << literal", () => {
      const p = new Parser(`fn infix_shift_left(): i32 {
        return 44 << 2;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (!assertFunctionSignature(funcStmt, "infix_shift_left", [], "i32", 1, false)) {
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
      assert(operator === "<<");
      assert(right.value === 2);
    });

    test("infix right shift: literal >> literal", () => {
      const p = new Parser(`fn infix_shift_right(): i32 {
        return 44 >> 2;
      }`);
      const ast = p.parse("test");
      assert(p.errors.length === 0);
      assert(ast.statements.length === 1);
      const funcStmt = ast.statements[0];
      if (!assertFunctionSignature(funcStmt, "infix_shift_right", [], "i32", 1, false)) {
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
      assert(operator === ">>");
      assert(right.value === 2);
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
      if (!assertFunctionSignature(funcStmt, "prefix_neg", [], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "prefix_neg", [["n", "i32"]], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "prefix_not", [], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "prefix_not", [["n", "i32"]], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "prefix_logical_not", [], "bool", 1, false)) {
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
        !assertFunctionSignature(funcStmt, "prefix_logical_not", [["b", "bool"]], "bool", 1, false)
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
      if (!assertFunctionSignature(funcStmt, "post_inc", [["n", "i32"]], "i32", 1, false)) {
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
      if (!assertFunctionSignature(funcStmt, "post_dec", [["n", "i32"]], "i32", 1, false)) {
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

describe("Parser: Cast", () => {
  test("simple cast: integer literal as f32", () => {
    const p = new Parser("fn test(): f32 { return 5 as f32; }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0);
    const fn = ast.statements[0];
    assert(fn instanceof FunctionStatement);
    const ret = fn.fnExpr.body.statements[0];
    assert(ret instanceof ReturnStatement);
    const cast = ret.returnValue;
    assert(cast instanceof CastExpression);
    assert.equal(cast.targetType, "f32");
    assert(cast.expr instanceof IntegerLiteralExpression);
  });

  test("simple cast: float literal as i32", () => {
    const p = new Parser("fn test(): i32 { return 3.14 as i32; }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0);
    const fn = ast.statements[0];
    assert(fn instanceof FunctionStatement);
    const ret = fn.fnExpr.body.statements[0];
    assert(ret instanceof ReturnStatement);
    const cast = ret.returnValue;
    assert(cast instanceof CastExpression);
    assert.equal(cast.targetType, "i32");
    assert(cast.expr instanceof FloatLiteralExpression);
  });

  test("cast binds tighter than addition: x as f32 + 1.0 parses as (x as f32) + 1.0", () => {
    const p = new Parser("fn test(x: i32): f32 { return x as f32 + 1.0; }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0);
    const fn = ast.statements[0];
    assert(fn instanceof FunctionStatement);
    const ret = fn.fnExpr.body.statements[0];
    assert(ret instanceof ReturnStatement);
    // outer node should be an infix + with left being a CastExpression
    const infix = ret.returnValue;
    assert(infix instanceof InfixExpression);
    assert.equal(infix.operator, "+");
    assert(infix.left instanceof CastExpression);
    assert.equal(infix.left.targetType, "f32");
  });

  test("cast to same-family type: n as u8 parses with targetType u8", () => {
    const p = new Parser("fn test(n: i32): i32 { return n as u8; }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0);
    const fn = ast.statements[0];
    assert(fn instanceof FunctionStatement);
    const ret = fn.fnExpr.body.statements[0];
    assert(ret instanceof ReturnStatement);
    const cast = ret.returnValue;
    assert(cast instanceof CastExpression);
    assert.equal(cast.targetType, "u8");
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
    if (!assertFunctionSignature(funcStmt, "member_access", [], "i32", 1, false)) {
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
    if (!assertFunctionSignature(funcStmt, "member_access", [], "i32", 2, false)) {
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

describe("Parser: Array Access", () => {
  const array_def = `let arr: i32[] = [1,2,3,4,5,6];`;

  // let arr: i32[] = [...];
  test("can parse array literal", () => {
    const p = new Parser(array_def);
    const _ast = p.parse("test");
    assert(p.errors.length === 0);
  });

  // let x: i32 = arr[3];
  test("can parse array access: literal", () => {
    const p = new Parser(`${array_def}
fn test_arr(): void {
  let x: i32 = arr[3];
}
`);
    const _ast = p.parse("test");
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
    const _ast = p.parse("test");
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
    const _ast = p.parse("test");
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
    const _ast = p.parse("test");
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
    const _ast = p.parse("test");
    assert(p.errors.length === 0);
  });
});

describe("Parser: Identifier", () => {
  test("toString returns token literal", () => {
    const token = {
      type: "Identifier" as const,
      literal: "myVar",
      col: 0,
      line: 0,
      end: 0,
      start: 0,
    };
    const ident = new Identifier(token, "i32");
    assert.doesNotThrow(() => ident.toString());
    assert.equal(ident.toString(), "myVar");
  });

  test("toString matches tokenLiteral on parsed identifiers", () => {
    const p = new Parser("fn test(x: i32): i32 { return x; }");
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const fn = ast.statements[0] as FunctionStatement;
    const param = fn.fnExpr.params[0].identifier as Identifier;
    assert.equal(param.toString(), param.tokenLiteral());
  });
});

describe("Parser: 9B multi-return and destructure", () => {
  test("parses tuple function return type", () => {
    const p = new Parser("fn swap(a: i32, b: i32): (i32, i32) { return b, a; }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[0];
    assert(fn instanceof FunctionStatement);
    assert.deepEqual(fn.fnExpr.returnTypes, ["i32", "i32"]);
  });

  test("parses tuple return type with trailing comma", () => {
    const p = new Parser("fn f(): (i32, i64,) { return 1, 2 as i64; }");
    p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
  });

  test("parses three-element tuple return type", () => {
    const p = new Parser("fn f(): (i32, i32, i32) { return 1, 2, 3; }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[0];
    assert(fn instanceof FunctionStatement);
    assert.deepEqual(fn.fnExpr.returnTypes, ["i32", "i32", "i32"]);
  });

  test("parses five-element tuple return type", () => {
    const p = new Parser("fn f(): (i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5; }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[0];
    assert(fn instanceof FunctionStatement);
    assert.equal(fn.fnExpr.returnTypes.length, 5);
  });

  test("parses six-element tuple return type", () => {
    const p = new Parser("fn f(): (i32, i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5, 6; }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[0];
    assert(fn instanceof FunctionStatement);
    assert.equal(fn.fnExpr.returnTypes.length, 6);
  });

  test("rejects single-element tuple return type", () => {
    const p = new Parser("fn f(): (i32) { return 1; }");
    p.parse("test");
    assert(p.errors.some((e) => e.message.includes("multi-return requires at least 2 types")));
  });

  test("rejects empty tuple return type", () => {
    const p = new Parser("fn f(): () { return; }");
    p.parse("test");
    assert(p.errors.some((e) => e.message.includes("multi-return requires at least 2 types")));
  });

  test("rejects void inside tuple return type", () => {
    const p = new Parser("fn f(): (i32, void) { return 1, 2; }");
    p.parse("test");
    assert(p.errors.some((e) => e.message.includes("return type may not contain void")));
  });

  test("parses return with multiple expressions", () => {
    const p = new Parser("fn f(): (i32, i32) { return 1 + 2, 3; }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[0];
    assert(fn instanceof FunctionStatement);
    const ret = fn.fnExpr.body.statements[0];
    assert(ret instanceof ReturnStatement);
    assert.equal(ret.returnValues.length, 2);
    assert(ret.returnValue instanceof InfixExpression);
  });

  test("parses return with trailing comma", () => {
    const p = new Parser("fn f(): (i32, i32) { return 1, 2,; }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[0];
    assert(fn instanceof FunctionStatement);
    const ret = fn.fnExpr.body.statements[0];
    assert(ret instanceof ReturnStatement);
    assert.equal(ret.returnValues.length, 2);
  });

  test("parses return with five expressions", () => {
    const p = new Parser("fn f(): (i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5; }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[0];
    assert(fn instanceof FunctionStatement);
    const ret = fn.fnExpr.body.statements[0];
    assert(ret instanceof ReturnStatement);
    assert.equal(ret.returnValues.length, 5);
  });

  test("parses destructuring let with names", () => {
    const p = new Parser(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): void {
        let (x, y) = swap(1, 2);
        let z: i32 = x + y;
      }
    `);
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[1];
    assert(fn instanceof FunctionStatement);
    const letStmt = fn.fnExpr.body.statements[0];
    assert(letStmt instanceof LetStatement);
    assert(letStmt.pattern instanceof TuplePattern);
    assert.equal(letStmt.pattern.names.length, 2);
    assert.equal(letStmt.pattern.names[0]?.kind, "name");
    assert.equal(letStmt.pattern.names[1]?.kind, "name");
  });

  test("parses destructuring let with discard", () => {
    const p = new Parser(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): void { let (_, y) = swap(1, 2); }
    `);
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[1];
    assert(fn instanceof FunctionStatement);
    const letStmt = fn.fnExpr.body.statements[0];
    assert(letStmt instanceof LetStatement);
    assert(letStmt.pattern instanceof TuplePattern);
    assert.equal(letStmt.pattern.names[0]?.kind, "discard");
    assert.equal(letStmt.pattern.names[1]?.kind, "name");
  });

  test("parses destructuring let trailing comma", () => {
    const p = new Parser(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): void { let (x, y,) = swap(1, 2); }
    `);
    p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
  });

  test("parses three-name destructuring let", () => {
    const p = new Parser(`
      fn tri(): (i32, i32, i32) { return 1, 2, 3; }
      fn f(): void { let (a, b, c) = tri(); }
    `);
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[1];
    assert(fn instanceof FunctionStatement);
    const letStmt = fn.fnExpr.body.statements[0];
    assert(letStmt instanceof LetStatement);
    assert(letStmt.pattern instanceof TuplePattern);
    assert.equal(letStmt.pattern.names.length, 3);
  });

  test("parses five-name destructuring let with discard", () => {
    const p = new Parser(`
      fn many(): (i32, i32, i32, i32, i32) { return 1, 2, 3, 4, 5; }
      fn f(): void { let (a, _, c, d, e) = many(); }
    `);
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[1];
    assert(fn instanceof FunctionStatement);
    const letStmt = fn.fnExpr.body.statements[0];
    assert(letStmt instanceof LetStatement);
    assert(letStmt.pattern instanceof TuplePattern);
    assert.equal(letStmt.pattern.names.length, 5);
    assert.equal(letStmt.pattern.names[1]?.kind, "discard");
  });

  test("rejects destructuring let with one name", () => {
    const p = new Parser("fn f(): void { let (x) = g(); }");
    p.parse("test");
    assert(p.errors.some((e) => e.message.includes("destructuring let requires at least 2 names")));
  });

  test("rejects empty destructuring let", () => {
    const p = new Parser("fn f(): void { let () = g(); }");
    p.parse("test");
    assert(p.errors.some((e) => e.message.includes("destructuring let requires at least 2 names")));
  });

  test("rejects per-binding type annotation", () => {
    const p = new Parser(`
      fn s(): (i32, i32) { return 1, 2; }
      fn f(): void { let (x: i32, y) = s(); }
    `);
    p.parse("test");
    assert(
      p.errors.some((e) =>
        e.message.includes("destructuring let does not support per-binding type annotations"),
      ),
    );
  });

  test("rejects tuple type annotation on destructure", () => {
    const p = new Parser(`
      fn s(): (i32, i32) { return 1, 2; }
      fn f(): void { let (x, y): (i32, i32) = s(); }
    `);
    p.parse("test");
    assert(
      p.errors.some((e) =>
        e.message.includes("destructuring let does not support a tuple type annotation"),
      ),
    );
  });

  test("rejects non-call rhs for destructure", () => {
    const p = new Parser("fn f(): void { let (x, y) = 5; }");
    p.parse("test");
    assert(
      p.errors.some((e) => e.message.includes("destructuring let RHS must be a function call")),
    );
  });

  test("rejects duplicate names inside destructure", () => {
    const p = new Parser(`
      fn s(): (i32, i32) { return 1, 2; }
      fn f(): void { let (x, x) = s(); }
    `);
    p.parse("test");
    assert(p.errors.some((e) => e.message.includes("duplicate binding in destructure")));
  });

  test("rejects const destructure", () => {
    const p = new Parser(`
      fn s(): (i32, i32) { return 1, 2; }
      fn f(): void { const (x, y) = s(); }
    `);
    p.parse("test");
    assert(p.errors.some((e) => e.message.includes("const destructure is not supported")));
  });

  test("rejects top-level destructuring let", () => {
    const p = new Parser(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      let (x, y) = swap(1, 2);
    `);
    p.parse("test");
    assert(
      p.errors.some((e) => e.message.includes("top-level destructuring let is not supported")),
    );
  });

  test("rejects inferred single let from multi-return call", () => {
    const p = new Parser(`
      fn swap(a: i32, b: i32): (i32, i32) { return b, a; }
      fn f(): void { let x = swap(1, 2); }
    `);
    p.parse("test");
    assert(
      p.errors.some((e) =>
        e.message.includes("Cannot infer type - for multi-return calls use destructuring"),
      ),
    );
  });

  test("import uses unresolved-import placeholder in parser scope", () => {
    const p = new Parser('import PI from "math"');
    p.parse("test");
    assert.equal(p.errors.length, 0);
    assert.equal(p.getIdentifierTypeHint("PI"), "<unresolved-import>");
  });
});

describe("Parser: 10A function types", () => {
  test("lexer produces Func token for source 'fn'", () => {
    const tz = new Tokenizer("fn");
    const tok = tz.curToken();
    assert.equal(tok.type, "Func");
  });

  test("parses fn(i32): i32 as callback parameter type", () => {
    const p = new Parser("fn run(cb: fn(i32): i32): void {}");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[0];
    assert(fn instanceof FunctionStatement);
    assert.equal(fn.fnExpr.params[0]?.type, "fn(i32):i32");
  });

  test("parses fn(i32, f32, bool): i32", () => {
    const p = new Parser("fn g(f: fn(i32, f32, bool): i32): void {}");
    p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
  });

  test("parses fn(i32): void and fn(): i32 and fn(): void", () => {
    for (const src of [
      "fn a(f: fn(i32): void): void {}",
      "fn b(): fn(): i32 { return 1 as i32; }",
      "fn c(x: fn(): void): void {}",
    ]) {
      const p = new Parser(src);
      p.parse("test");
      assert.equal(p.errors.length, 0, `${src}: ${p.errors.map((e) => e.message).join("; ")}`);
    }
  });

  test("parses multi-return fn type fn(i32): (i32, i32)", () => {
    const p = new Parser("fn h(f: fn(i32): (i32, i32)): void {}");
    p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
  });

  test("parses trailing comma in fn type params", () => {
    const p = new Parser("fn j(f: fn(i32, i32,): void): void {}");
    p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
  });

  test("parses nested return fn(i32): fn(i32): i32", () => {
    const p = new Parser("fn k(f: fn(i32): fn(i32): i32): void {}");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[0] as FunctionStatement;
    assert.equal(fn.fnExpr.params[0]?.type, "fn(i32):fn(i32):i32");
  });

  test("parses nested param fn(fn(i32): i32, i32): i32", () => {
    const p = new Parser("fn m(f: fn(fn(i32): i32, i32): i32): void {}");
    p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
  });

  test("parses fn-type as struct member", () => {
    const p = new Parser("struct H { cb: fn(i32): void, }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const st = ast.statements[0];
    assert(st instanceof StructStatement);
    assert.equal(st.members.cb?.type, "fn(i32):void");
  });

  test("parses fn(i32): i32[] as array return", () => {
    const p = new Parser("fn ar(): fn(i32): i32[] {}");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[0] as FunctionStatement;
    assert.equal(fn.fnExpr.returnTypes[0], "fn(i32):i32[]");
  });

  test("fn name(...) at top level still parses as function declaration", () => {
    const p = new Parser("fn add(a: i32, b: i32): i32 { return a + b; }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0);
    assert(ast.statements[0] instanceof FunctionStatement);
  });

  test("fn(x: i32): i32 { } in expression position parses as FunctionLiteralExpression", () => {
    const p = new Parser("fn outer(): void { let f = fn(x: i32): i32 { return x; }; }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const outer = ast.statements[0] as FunctionStatement;
    const letStmt = outer.fnExpr.body.statements[0];
    assert(letStmt instanceof LetStatement);
    assert(letStmt.expression instanceof FunctionLiteralExpression);
  });

  test("rejects bare fn in type position without (", () => {
    const p = new Parser("let f: fn = 5;");
    p.parse("test");
    assert(p.errors.some((e) => e.message.includes("expected '(' after fn in type")));
  });

  test("rejects missing ':' after fn params", () => {
    const p = new Parser("let f: fn(i32) i32 = 5;");
    p.parse("test");
    assert(p.errors.some((e) => e.message.includes("expected ':' after fn type params")));
  });

  test("rejects empty multi-return tuple in fn return position", () => {
    const p = new Parser("let f: fn(): () = 5;");
    p.parse("test");
    assert(p.errors.some((e) => e.message.includes("multi-return requires at least 2 types")));
  });

  test("rejects single-tuple fn(): (i32)", () => {
    const p = new Parser("let f: fn(): (i32) = 5;");
    p.parse("test");
    assert(p.errors.some((e) => e.message.includes("multi-return requires at least 2 types")));
  });

  test("rejects void as fn type param", () => {
    const p = new Parser("let f: fn(i32, void): i32 = 5;");
    p.parse("test");
    assert(p.errors.some((e) => e.message.includes("void cannot appear as a parameter type")));
  });

  test("rejects void in multi-return fn type tuple", () => {
    const p = new Parser("let f: fn(): (i32, void) = 5;");
    p.parse("test");
    assert(
      p.errors.some(
        (e) =>
          e.message.includes("void cannot appear in a multi-return tuple") ||
          e.message.includes("return type may not contain void"),
      ),
    );
  });

  test("rejects fn() without void after colon", () => {
    const p = new Parser("let f: fn() = 5;");
    p.parse("test");
    assert(p.errors.some((e) => e.message.includes("expected ':' after fn type params")));
  });

  test("rejects forward and reverse fn-type casts", () => {
    const p1 = new Parser("fn x(): void { let f: fn(i32):i32 = add as fn(i32):i32; }");
    p1.parse("test");
    assert(p1.errors.some((e) => e.message.includes("fn-type casts are not supported")));

    const p2 = new Parser("fn run(op: fn(i32):i32): void { let n: i32 = op as i32; }");
    p2.parse("test");
    assert(p2.errors.some((e) => e.message.includes("fn-type casts are not supported")));
  });

  test("rejects integer cast to fn type", () => {
    const p = new Parser("fn x(): void { let f: fn(i32):i32 = 0 as fn(i32):i32; }");
    p.parse("test");
    assert(p.errors.some((e) => e.message.includes("fn-type casts are not supported")));
  });

  test("rejects reserved prefixes in bindings", () => {
    for (const name of ["__lambda_x", "__indirect_x", "__env", "__make_fnref", "__fn_table"]) {
      const p = new Parser(`fn x(): void { let ${name} = 5; }`);
      p.parse("test");
      assert(
        p.errors.some((e) => e.message.includes("reserved prefix")),
        name,
      );
    }
  });

  test("rejects reserved prefix in fn name struct field and param", () => {
    const p1 = new Parser("fn __lambda_5(): void {}");
    p1.parse("test");
    assert(p1.errors.some((e) => e.message.includes("reserved prefix")));

    const p2 = new Parser("struct H { __lambda_x: i32, }");
    p2.parse("test");
    assert(p2.errors.some((e) => e.message.includes("reserved prefix")));

    const p3 = new Parser("fn f(__lambda_x: i32): void {}");
    p3.parse("test");
    assert(p3.errors.some((e) => e.message.includes("reserved prefix")));
  });

  // ─── Compositional regressions for fn-types ─────────────────────────────────
  // These cover positions where the fn-type isn't the last thing of its kind
  // (param, struct field, tuple return), plus array types inside fn params.

  test("parses fn-typed param followed by a scalar param", () => {
    const p = new Parser("fn g(f: fn(i32): i32, x: i32): void {}");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[0] as FunctionStatement;
    assert.equal(fn.fnExpr.params[0]?.type, "fn(i32):i32");
    assert.equal(fn.fnExpr.params[1]?.type, "i32");
  });

  test("parses scalar param followed by an fn-typed param", () => {
    const p = new Parser("fn g(x: i32, f: fn(i32): i32): void {}");
    p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
  });

  test("parses two consecutive fn-typed params", () => {
    const p = new Parser("fn g(f: fn(i32): i32, h: fn(f32): f32): void {}");
    p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
  });

  test("parses fn-typed param with multi-return followed by another param", () => {
    const p = new Parser("fn g(f: fn(i32): (i32, i32), x: i32): void {}");
    p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
  });

  test("parses fn-type with array param: fn(i32[]): void", () => {
    const p = new Parser("fn g(f: fn(i32[]): void): void {}");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const fn = ast.statements[0] as FunctionStatement;
    assert.equal(fn.fnExpr.params[0]?.type, "fn(i32[]):void");
  });

  test("parses fn-type with mixed array and scalar params", () => {
    const p = new Parser("fn g(f: fn(i32[], f32): void): void {}");
    p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
  });

  test("parses fn-typed struct field followed by another field", () => {
    const p = new Parser("struct H { cb: fn(i32): i32, n: i32, }");
    const ast = p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
    const st = ast.statements[0];
    assert(st instanceof StructStatement);
    assert.equal(st.members.cb?.type, "fn(i32):i32");
    assert.equal(st.members.n?.type, "i32");
  });

  test("parses fn-typed struct field without trailing comma", () => {
    const p = new Parser("struct H { cb: fn(i32): i32 }");
    p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
  });

  test("parses fn-type inside a multi-return tuple return type", () => {
    const p = new Parser("fn g(): (i32, fn(i32): i32) { return 0, 0 as i32; }");
    p.parse("test");
    assert.equal(p.errors.length, 0, p.errors.map((e) => e.message).join("; "));
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
  members: Record<string, StructMember>,
): structStmt is StructStatement {
  assert(structStmt instanceof StructStatement);
  assert(structStmt.name === name);
  assert(Object.keys(structStmt.members).length === Object.keys(members).length);

  for (const [key, data] of Object.entries(members)) {
    assert(!!structStmt.members[key], `Struct: "${name}" expected member does not exist: "${key}"`);
    assert(structStmt.members[key].name === data.name);
    assert(
      structStmt.members[key].offset === data.offset,
      `Struct: "${name}" member: "${data.name}" incorrect offset. Expected: "${data.offset}", Got: "${structStmt.members[key].offset}"`,
    );
    assert(
      structStmt.members[key].size === data.size,
      `Struct: "${name}" member: "${data.name}" incorrect size. Expected: "${data.size}", Got: "${structStmt.members[key].size}"`,
    );
    assert(
      structStmt.members[key].type === data.type,
      `Struct: "${name}" member: "${data.name}" incorrect type. Expected: "${data.type}", Got: "${structStmt.members[key].type}"`,
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
  exported: boolean,
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
// ─── Error recovery tests ─────────────────────────────────────────────────────

describe("Parser: Error recovery", () => {
  test("bare identifier without semicolon at top level does not hang", () => {
    // Previously caused an infinite loop / OOM crash
    const p = new Parser("asdads\nfn f(): i32 { return 1; }");
    p.parse("test");
    // Parser must finish — if it hangs the test runner catches it via timeout
    assert(p.errors.length >= 0); // just asserting no crash
  });

  test("missing semicolon inside a function body does not hang", () => {
    const p = new Parser("fn test(): void {\n  let x: i32 = 5\n}");
    p.parse("test");
    assert(p.errors.length > 0);
  });

  test("multiple errors in one file are all collected", () => {
    const p = new Parser(
      "fn a(): void {\n  let x: i32 = 5\n}\nfn b(): void {\n  let y: i32 = 6\n}",
    );
    p.parse("test");
    assert(p.errors.length >= 2, `Expected >=2 errors, got ${p.errors.length}`);
  });

  test("valid code after a top-level error is still parsed", () => {
    const p = new Parser("asdads\nfn f(): i32 { return 1; }");
    const ast = p.parse("test");
    const fnNames = ast.statements
      .filter((s) => s.constructor.name === "FunctionStatement")
      .map((s) => s.tokenLiteral());
    assert(fnNames.includes("fn"), "FunctionStatement should be present after the bad identifier");
  });
});

// ─── Error position tests ─────────────────────────────────────────────────────

describe("Parser: Error positions", () => {
  test("errors expose .line directly (not nested in .token)", () => {
    const p = new Parser("let x:");
    p.parse("test");
    assert(p.errors.length > 0, "Expected at least one parse error");
    const err = p.errors[0];
    assert.equal(typeof err.line, "number", "err.line must be a number");
    assert(err.line >= 1, "err.line must be >= 1");
  });

  test("errors expose .col directly (not nested in .token)", () => {
    const p = new Parser("let x:");
    p.parse("test");
    assert(p.errors.length > 0, "Expected at least one parse error");
    const err = p.errors[0];
    assert.equal(typeof err.col, "number", "err.col must be a number");
    assert(err.col >= 1, "err.col must be >= 1");
  });

  test("error .line matches source line of the error token (line 1)", () => {
    // "let x:" — EOF token is on line 1
    const p = new Parser("let x:");
    p.parse("test");
    assert(p.errors.length > 0);
    assert.equal(p.errors[0].line, 1);
  });

  test("error .line is 2 when the invalid token sits on line 2", () => {
    // Valid function on line 1, broken let on line 2 — EOF is on line 2
    const p = new Parser("fn f(): void {}\nlet x:");
    p.parse("test");
    assert(p.errors.length > 0);
    assert.equal(p.errors[0].line, 2);
  });

  test("error .col is correct for token on line 1", () => {
    // "let x:" — EOF is at col 7 (positions: l=1,e=2,t=3,_=4,x=5,:=6,EOF=7)
    const p = new Parser("let x:");
    p.parse("test");
    assert(p.errors.length > 0);
    assert.equal(p.errors[0].col, 7);
  });

  test("error .file reflects filename passed to Parser constructor", () => {
    const p = new Parser("let x:", "myfile.maple");
    p.parse("test");
    assert(p.errors.length > 0);
    assert.equal(p.errors[0].file, "myfile.maple");
  });

  test("error .file is empty string when no filename is supplied", () => {
    const p = new Parser("let x:");
    p.parse("test");
    assert(p.errors.length > 0);
    assert.equal(p.errors[0].file, "");
  });

  test("error message text is preserved on MapleError", () => {
    const p = new Parser("let x:");
    p.parse("test");
    assert(p.errors.length > 0);
    const err = p.errors[0];
    assert(typeof err.message === "string" && err.message.length > 0);
    assert(
      err.message.toLowerCase().includes("type") || err.message.toLowerCase().includes("expected"),
      `Expected message about type/expected, got: "${err.message}"`,
    );
  });

  test("error from missing expression exposes .line and .col", () => {
    // "let x: i32 =" — EOF is the expression, fires noPrefixParseFnError
    // positions: l=1 e=2 t=3 _=4 x=5 :=6 _=7 i=8 3=9 2=10 _=11 ==12 _=13 EOF=14
    const p = new Parser("let x: i32 =");
    p.parse("test");
    assert(p.errors.length > 0);
    const err = p.errors[0];
    assert.equal(typeof err.line, "number");
    assert.equal(err.line, 1);
    assert.equal(typeof err.col, "number");
    assert(err.col >= 1);
  });
});

describe("Parser: Type inference", () => {
  function parseLet(src: string): LetStatement {
    const p = new Parser(src);
    const prog = p.parse("test");
    const stmt = prog.statements[0];
    assert(stmt instanceof LetStatement, `Expected LetStatement, got ${stmt?.constructor?.name}`);
    return stmt;
  }

  test("infers i32 from integer literal", () => {
    const stmt = parseLet("let x = 5;");
    assert.equal(stmt.typeAnnotation, "i32");
  });

  test("infers f32 from float literal", () => {
    const stmt = parseLet("let y = 3.14;");
    assert.equal(stmt.typeAnnotation, "f32");
  });

  test("infers bool from boolean literal", () => {
    const stmt = parseLet("let b = true;");
    assert.equal(stmt.typeAnnotation, "bool");
  });

  test("infers string from string literal", () => {
    const stmt = parseLet('let s = "hello";');
    assert.equal(stmt.typeAnnotation, "string");
    assert(stmt.expression instanceof StringLiteralExpression);
    assert.equal(stmt.expression.value, "hello");
  });

  test("explicit i32 annotation still works (no regression)", () => {
    const stmt = parseLet("let x: i32 = 5;");
    assert.equal(stmt.typeAnnotation, "i32");
  });

  test("explicit string annotation parses and stores string literal expression", () => {
    const stmt = parseLet('let s: string = "hello";');
    assert.equal(stmt.typeAnnotation, "string");
    assert(stmt.expression instanceof StringLiteralExpression);
    assert.equal(stmt.expression.value, "hello");
  });

  test("infers i32 from i32 infix expression", () => {
    const stmt = parseLet("let r = 1 + 2;");
    assert.equal(stmt.typeAnnotation, "i32");
  });

  test("infers f32 from f32 infix expression", () => {
    const stmt = parseLet("let r = 1.0 + 2.0;");
    assert.equal(stmt.typeAnnotation, "f32");
  });

  test("infers f32 from cast expression", () => {
    const stmt = parseLet("let c = 1 as f32;");
    assert.equal(stmt.typeAnnotation, "f32");
  });

  test("infers struct type from literal when struct is defined", () => {
    const src = `
      struct P { x: i32, y: i32, }
      let p = { x = 1, y = 2 };
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const letStmt = prog.statements[1];
    assert(letStmt instanceof LetStatement);
    assert.equal(letStmt.typeAnnotation, "P");
  });

  test("parse error when struct literal matches multiple struct defs (ambiguous)", () => {
    const src = `
      struct Vec2  { x: i32, y: i32, }
      struct AVec2 { x: i32, y: i32, }
      let p = { x = 1, y = 2 };
    `;
    const p = new Parser(src);
    p.parse("test");
    assert(p.errors.length > 0, "Expected at least one parse error");
    assert(
      p.errors.some((e) => e.message.includes("Ambiguous")),
      `Expected "Ambiguous" error, got: ${p.errors.map((e) => e.message).join("; ")}`,
    );
  });

  test("parse error when struct literal has no matching struct def", () => {
    const src = "let p = { a = 1, b = 2 };";
    const p = new Parser(src);
    p.parse("test");
    assert(p.errors.length > 0, "Expected at least one parse error");
    assert(
      p.errors.some((e) => e.message.includes("Cannot infer struct type")),
      `Expected "Cannot infer struct type" error, got: ${p.errors.map((e) => e.message).join("; ")}`,
    );
  });

  test("infers i32[] from integer array literal", () => {
    const stmt = parseLet("let arr = [1, 2, 3];");
    assert.equal(stmt.typeAnnotation, "i32[]");
  });

  test("infers f32[] from float array literal", () => {
    const stmt = parseLet("let arr = [1.0, 2.0];");
    assert.equal(stmt.typeAnnotation, "f32[]");
  });

  test("regression: explicit i32[] annotation stores full type", () => {
    const stmt = parseLet("let arr: i32[] = [1, 2, 3];");
    assert.equal(stmt.typeAnnotation, "i32[]");
  });

  test("explicit i32[] annotation: ArrayLiteralExpression.memberType is element type 'i32'", () => {
    const stmt = parseLet("let arr: i32[] = [1, 2, 3];");
    assert(stmt.expression instanceof ArrayLiteralExpression);
    assert.equal(stmt.expression.memberType, "i32");
  });

  test("explicit f32[] annotation: ArrayLiteralExpression.memberType is element type 'f32'", () => {
    const stmt = parseLet("let arr: f32[] = [1.0, 2.0];");
    assert(stmt.expression instanceof ArrayLiteralExpression);
    assert.equal(stmt.expression.memberType, "f32");
  });

  test("infers i32 from member access on inferred struct", () => {
    const src = `
      struct P { x: i32, y: i32, }
      let p: P = { x = 1, y = 2 };
      let z = p.x;
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const letStmt = prog.statements[2];
    assert(letStmt instanceof LetStatement);
    assert.equal(letStmt.typeAnnotation, "i32");
  });

  test("infers i32 from call to previously declared function (no annotation needed)", () => {
    const src = `
      fn add(a: i32, b: i32): i32 { return a + b; }
      let x = add(1, 2);
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[1];
    assert(stmt instanceof LetStatement);
    assert.equal(stmt.typeAnnotation, "i32");
  });

  test("string literal as standalone expression parses", () => {
    const p = new Parser('"hello";');
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[0];
    assert(stmt instanceof ExpressionStatement);
    assert(stmt.expression instanceof StringLiteralExpression);
    assert.equal(stmt.expression.value, "hello");
  });

  test("function parameter with string type parses", () => {
    const p = new Parser("fn f(s: string): void {}");
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[0];
    assert(stmt instanceof FunctionStatement);
    assertFunctionParams(stmt, [["s", "string"]]);
  });
});

describe("Parser: Call return type inference", () => {
  test("infers f32 from call to previously declared f32 function", () => {
    const src = `
      fn half(x: f32): f32 { return x; }
      let y = half(1.0);
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[1];
    assert(stmt instanceof LetStatement);
    assert.equal(stmt.typeAnnotation, "f32");
  });

  test("infers bool from call to previously declared bool function", () => {
    const src = `
      fn isZero(x: i32): bool { return x == 0; }
      let b = isZero(5);
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[1];
    assert(stmt instanceof LetStatement);
    assert.equal(stmt.typeAnnotation, "bool");
  });

  test("infers struct type from call to struct-returning function", () => {
    const src = `
      struct P { x: i32, y: i32, }
      fn origin(): P { let p: P = { x = 0, y = 0 }; return p; }
      let o = origin();
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[2];
    assert(stmt instanceof LetStatement);
    assert.equal(stmt.typeAnnotation, "P");
  });

  test("void function call in let is still a parse error", () => {
    const src = `
      fn doNothing(): void { }
      let x = doNothing();
    `;
    const p = new Parser(src);
    p.parse("test");
    assert(p.errors.length > 0, "Expected at least one parse error");
    assert(
      p.errors.some((e) => e.message.includes("Cannot infer type")),
      `Expected "Cannot infer type" error, got: ${p.errors.map((e) => e.message).join("; ")}`,
    );
  });

  test("forward reference to function declared later still requires annotation", () => {
    const src = `
      let x = later(1);
      fn later(a: i32): i32 { return a; }
    `;
    const p = new Parser(src);
    p.parse("test");
    assert(p.errors.length > 0, "Expected at least one parse error");
    assert(
      p.errors.some((e) => e.message.includes("Cannot infer type")),
      `Expected "Cannot infer type" error, got: ${p.errors.map((e) => e.message).join("; ")}`,
    );
  });

  test("infers i32 from struct method call", () => {
    const src = `
      struct P { x: i32, y: i32, }
      fn P.sum(p)(): i32 { return p.x + p.y; }
      let pt: P = { x = 1, y = 2 };
      let s = pt.sum();
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[3];
    assert(stmt instanceof LetStatement);
    assert.equal(stmt.typeAnnotation, "i32");
  });

  test("infers f32 from struct method call with params", () => {
    const src = `
      struct V { x: f32, y: f32, }
      fn V.len(v)(): f32 { return v.x; }
      let vec: V = { x = 1.0, y = 2.0 };
      let length = vec.len();
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[3];
    assert(stmt instanceof LetStatement);
    assert.equal(stmt.typeAnnotation, "f32");
  });

  test("infers i32 from call in arithmetic expression", () => {
    const src = `
      fn double(x: i32): i32 { return x * 2; }
      let y = double(5) + 3;
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[1];
    assert(stmt instanceof LetStatement);
    assert.equal(stmt.typeAnnotation, "i32");
  });

  test("infers f32 when call returns i32 but other operand is f32", () => {
    const src = `
      fn one(): i32 { return 1; }
      let y = one() + 2.0;
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[1];
    assert(stmt instanceof LetStatement);
    assert.equal(stmt.typeAnnotation, "f32");
  });

  test("infers i32 from nested function calls", () => {
    const src = `
      fn add(a: i32, b: i32): i32 { return a + b; }
      let x = add(add(1, 2), 3);
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[1];
    assert(stmt instanceof LetStatement);
    assert.equal(stmt.typeAnnotation, "i32");
  });

  test("infers bool from comparison involving function call", () => {
    const src = `
      fn count(): i32 { return 5; }
      let over = count() > 3;
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[1];
    assert(stmt instanceof LetStatement);
    assert.equal(stmt.typeAnnotation, "bool");
  });

  test("infers i32 from negated function call", () => {
    const src = `
      fn val(): i32 { return 5; }
      let x = -val();
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[1];
    assert(stmt instanceof LetStatement);
    assert.equal(stmt.typeAnnotation, "i32");
  });

  test("infers correct types from multiple declared functions", () => {
    const src = `
      fn getInt(): i32 { return 1; }
      fn getFloat(): f32 { return 1.0; }
      let a = getInt();
      let b = getFloat();
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmtA = prog.statements[2];
    assert(stmtA instanceof LetStatement);
    assert.equal(stmtA.typeAnnotation, "i32");
    const stmtB = prog.statements[3];
    assert(stmtB instanceof LetStatement);
    assert.equal(stmtB.typeAnnotation, "f32");
  });

  test("const infers i32 from function call", () => {
    const src = `
      fn add(a: i32, b: i32): i32 { return a + b; }
      const x = add(1, 2);
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[1];
    assert(stmt instanceof LetStatement);
    assert.equal(stmt.typeAnnotation, "i32");
    assert.equal(stmt.mutable, false);
  });

  test("infers string from call to string-returning function", () => {
    const src = `
      fn greet(): string { return "hello"; }
      let s = greet();
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[1];
    assert(stmt instanceof LetStatement);
    assert.equal(stmt.typeAnnotation, "string");
  });

  test("imported function call still requires explicit annotation", () => {
    const src = `
      import add from "./math.maple"
      let x = add(1, 2);
    `;
    const p = new Parser(src);
    p.parse("test");
    assert(p.errors.length > 0, "Expected at least one parse error");
    assert(
      p.errors.some((e) => e.message.includes("Cannot infer type")),
      `Expected "Cannot infer type" error, got: ${p.errors.map((e) => e.message).join("; ")}`,
    );
  });

  test("explicit annotation on function call still works", () => {
    const src = `
      fn add(a: i32, b: i32): i32 { return a + b; }
      let x: i32 = add(1, 2);
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const stmt = prog.statements[1];
    assert(stmt instanceof LetStatement);
    assert.equal(stmt.typeAnnotation, "i32");
  });

  test("recursive call within own body requires explicit annotation", () => {
    const src = `
      fn fib(n: i32): i32 {
        let x = fib(n - 1);
        return x;
      }
    `;
    const p = new Parser(src);
    p.parse("test");
    assert(p.errors.length > 0, "Expected at least one parse error");
    assert(
      p.errors.some((e) => e.message.includes("Cannot infer type")),
      `Expected "Cannot infer type" error, got: ${p.errors.map((e) => e.message).join("; ")}`,
    );
  });

  test("infers i32 from call to nested function declared earlier in enclosing body", () => {
    const src = `
      fn outer(): void {
        fn inner(): i32 { return 42; }
        let x = inner();
      }
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);
    const outer = prog.statements[0];
    assert(outer instanceof FunctionStatement);
    const innerLet = outer.fnExpr.body.statements[1];
    assert(innerLet instanceof LetStatement);
    assert.equal(innerLet.typeAnnotation, "i32");
  });
});

describe("Parser: Struct methods", () => {
  test("parses dotted method declaration with receiver binding", () => {
    const src = `
      struct Vec2 { x: i32, y: i32, }
      fn Vec2.add(v)(other: Vec2): Vec2 { return v; }
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);

    const stmt = prog.statements[1];
    assert(stmt instanceof FunctionStatement);
    assert.equal(stmt.name, "Vec2_add");
    assert.equal((stmt as unknown as { receiverType?: string | null }).receiverType, "Vec2");
    assertFunctionParams(stmt, [
      ["v", "Vec2"],
      ["other", "Vec2"],
    ]);
  });

  test("parses exported dotted method declaration", () => {
    const src = `
      struct Vec2 { x: i32, y: i32, }
      export fn Vec2.scale(v)(factor: i32): void {}
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);

    const stmt = prog.statements[1];
    assert(stmt instanceof FunctionStatement);
    assert.equal(stmt.exported, true);
    assert.equal(stmt.name, "Vec2_scale");
    assert.equal((stmt as unknown as { receiverType?: string | null }).receiverType, "Vec2");
    assertFunctionParams(stmt, [
      ["v", "Vec2"],
      ["factor", "i32"],
    ]);
  });

  test("reports parse error for dotted method missing receiver binding", () => {
    const src = `
      struct Vec2 { x: i32, y: i32, }
      fn Vec2.add(other: Vec2): Vec2 { return other; }
    `;
    const p = new Parser(src);
    p.parse("test");
    assert(p.errors.length > 0, "Expected parse error for missing receiver binding");
  });

  test("desugars method call into mangled function call with receiver first", () => {
    const src = `
      struct Vec2 { x: i32, y: i32, }
      fn test(v: Vec2, other: Vec2): void { v.add(other); }
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);

    const testFn = prog.statements[1];
    assert(testFn instanceof FunctionStatement);
    const stmt = testFn.fnExpr.body.statements[0];
    assert(stmt instanceof ExpressionStatement);
    assert(stmt.expression instanceof CallExpression);
    assert.equal(stmt.expression.func, "Vec2_add");
    assert.equal(stmt.expression.args.length, 2);
    assert(stmt.expression.args[0] instanceof Identifier);
    assert.equal(stmt.expression.args[0].tokenLiteral(), "v");
    assert(stmt.expression.args[1] instanceof Identifier);
    assert.equal(stmt.expression.args[1].tokenLiteral(), "other");
  });

  test("desugars no-arg method call into mangled function call with receiver only", () => {
    const src = `
      struct Vec2 { x: i32, y: i32, }
      fn test(v: Vec2): void { v.magnitude(); }
    `;
    const p = new Parser(src);
    const prog = p.parse("test");
    assert.equal(p.errors.length, 0, `Parse errors: ${p.errors.map((e) => e.message).join("; ")}`);

    const testFn = prog.statements[1];
    assert(testFn instanceof FunctionStatement);
    const stmt = testFn.fnExpr.body.statements[0];
    assert(stmt instanceof ExpressionStatement);
    assert(stmt.expression instanceof CallExpression);
    assert.equal(stmt.expression.func, "Vec2_magnitude");
    assert.equal(stmt.expression.args.length, 1);
    assert(stmt.expression.args[0] instanceof Identifier);
    assert.equal(stmt.expression.args[0].tokenLiteral(), "v");
  });
});

// ─── 8D: Control Flow Hardening ───────────────────────────────────────────────

describe("Parser: Control Flow Hardening - Error recovery (Bug 6)", () => {
  test("for loop with syntax error in body recovers and produces for statement", () => {
    // RED: manual body loop returns null on first bad statement, aborting entire for parse
    const p = new Parser(`fn f(): void { for (let i: i32 = 0; i < 5; i = i + 1) { let x: = 5; } }`);
    const prog = p.parse("test");
    assert(p.errors.length > 0, "Expected parse errors from syntax error in body");
    const fn = prog.statements[0];
    assert(fn instanceof FunctionStatement, "Expected FunctionStatement");
    assert(
      fn.fnExpr.body.statements.length > 0,
      "ForStatement should be produced despite error in body",
    );
    assert(fn.fnExpr.body.statements[0] instanceof ForStatement, "Expected ForStatement");
  });

  test("while loop with syntax error in body recovers and produces while statement", () => {
    // RED: same bug in parseWhileStatement
    const p = new Parser(`fn f(): void { while (1) { let x: = 5; } }`);
    const prog = p.parse("test");
    assert(p.errors.length > 0, "Expected parse errors from syntax error in body");
    const fn = prog.statements[0];
    assert(fn instanceof FunctionStatement, "Expected FunctionStatement");
    assert(
      fn.fnExpr.body.statements.length > 0,
      "WhileStatement should be produced despite error in body",
    );
    assert(fn.fnExpr.body.statements[0] instanceof WhileStatement, "Expected WhileStatement");
  });

  test("for loop with valid body still produces all statements", () => {
    // GREEN: normal for loop body parsing must not regress
    const p = new Parser(
      `fn f(): void { for (let i: i32 = 0; i < 3; i = i + 1) { let x: i32 = 1; let y: i32 = 2; } }`,
    );
    const prog = p.parse("test");
    assert.equal(
      p.errors.length,
      0,
      `Unexpected errors: ${p.errors.map((e) => e.message).join("; ")}`,
    );
    const fn = prog.statements[0];
    assert(fn instanceof FunctionStatement);
    const forStmt = fn.fnExpr.body.statements[0];
    assert(forStmt instanceof ForStatement);
    assert.equal(forStmt.loopBody.statements.length, 2, "Both body statements should be present");
  });

  test("while loop with valid body still produces all statements", () => {
    // GREEN: normal while body parsing must not regress
    const p = new Parser(`fn f(): void { while (1) { let x: i32 = 1; break; } }`);
    const prog = p.parse("test");
    assert.equal(
      p.errors.length,
      0,
      `Unexpected errors: ${p.errors.map((e) => e.message).join("; ")}`,
    );
    const fn = prog.statements[0];
    assert(fn instanceof FunctionStatement);
    const whileStmt = fn.fnExpr.body.statements[0];
    assert(whileStmt instanceof WhileStatement);
    assert.equal(whileStmt.loopBody.statements.length, 2, "Both body statements should be present");
  });
});

describe("Parser: Control Flow Hardening - If condition (Fix 9)", () => {
  test("if with empty condition reports parse error", () => {
    // GREEN: error is already reported, but condition null check ordering matters
    const p = new Parser(`fn f(): void { if () {} }`);
    p.parse("test");
    assert(p.errors.length > 0, "Expected parse error for if with empty condition");
  });

  test("if with valid condition parses correctly", () => {
    // GREEN: must not regress
    const p = new Parser(`fn f(): void { if (1) {} }`);
    const prog = p.parse("test");
    assert.equal(
      p.errors.length,
      0,
      `Unexpected errors: ${p.errors.map((e) => e.message).join("; ")}`,
    );
    const fn = prog.statements[0];
    assert(fn instanceof FunctionStatement);
    assert(fn.fnExpr.body.statements[0] instanceof IfStatement);
  });

  test("if missing closing paren reports parse error", () => {
    // GREEN: missing ) is caught by expectPeek
    const p = new Parser(`fn f(): void { if (1 {} }`);
    p.parse("test");
    assert(p.errors.length > 0, "Expected parse error for if missing )");
  });
});

function assertFunctionParams(
  funcStmt: FunctionStatement,
  expectedParams: Array<[string, string]>,
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
