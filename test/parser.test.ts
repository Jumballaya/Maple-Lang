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

// @TODO:
//
//      For Loop:
//        1. basic loop: for (i: i32 = 0; i < 10; i++) {}
//        2. loop with body
//        3. loop with a return
//        4. loop with a break
//
//      While Loop:
//        1. basic loop: while (i < 10) { i++; }
//        2. loop with a body
//        3. loop with a return
//        4. loop with a break
//
//      Pointers:
//        parse pointer syntax:     "*T"
//        member access             "T.m"
//        pointer member access     "T->m"
//        binds pointer and member operations correctly
//
//
//      Operators:
//        Math: +, -, /, *, %
//        Logic: &&, ||, !
//        Bitwise: &, |, ^, ~
//        Inc/Dec: ++, --
//
//      Function calls and nesting
//        1. a(b(c()))
//
//      Strings
//
//      Switch
//
//      Errors
//        reports missing items
//        collects multiple errors
//        expression precedence
//        respects logical operator precedence
//
//
//      General
//        supports chained call, index, and member expressions
//          1. a.b->c[3](f.g()[4]->h())
//

describe("Parser", () => {
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
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 0);
    assert(funcStmt.fnExpr.returnType === "void");
    assert(funcStmt.fnExpr.body.statements.length === 0);
  });

  test("can parse an exported function", () => {
    const p = new Parser("export fn test(): void {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 0);
    assert(funcStmt.fnExpr.returnType === "void");
    assert(funcStmt.fnExpr.body.statements.length === 0);
    assert(funcStmt.exported);
  });

  test("can parse a function that returns i32", () => {
    const p = new Parser("fn test(): i32 {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 0);
    assert(funcStmt.fnExpr.returnType === "i32");
    assert(funcStmt.fnExpr.body.statements.length === 0);
  });

  test("can parse a function that returns f32", () => {
    const p = new Parser("fn test(): f32 {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 0);
    assert(funcStmt.fnExpr.returnType === "f32");
    assert(funcStmt.fnExpr.body.statements.length === 0);
  });

  test("can parse a function that returns bool", () => {
    const p = new Parser("fn test(): bool {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 0);
    assert(funcStmt.fnExpr.returnType === "bool");
    assert(funcStmt.fnExpr.body.statements.length === 0);
  });

  test("can parse a function that returns a struct", () => {
    const p = new Parser("fn test(): Color {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 0);
    assert(funcStmt.fnExpr.returnType === "Color");
    assert(funcStmt.fnExpr.body.statements.length === 0);
  });

  test("can parse a function that returns an array", () => {
    const p = new Parser("fn test(): i32[] {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 0);
    assert(funcStmt.fnExpr.returnType === "i32[]");
    assert(funcStmt.fnExpr.body.statements.length === 0);
  });

  test("can parse a function that takes params", () => {
    const p = new Parser("fn add(a: i32, b: i32): i32 {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "add");
    assert(funcStmt.fnExpr.params.length === 2);
    const paramALiteral = funcStmt.fnExpr.params[0].identifier
      .tokenLiteral()
      .toString();
    const paramBLiteral = funcStmt.fnExpr.params[1].identifier
      .tokenLiteral()
      .toString();

    assert(paramALiteral === "a");
    assert(funcStmt.fnExpr.params[0].type === "i32");
    assert(paramBLiteral === "b");
    assert(funcStmt.fnExpr.params[1].type === "i32");

    assert(funcStmt.fnExpr.returnType === "i32");
    assert(funcStmt.fnExpr.body.statements.length === 0);
  });

  test("can parse a function that takes many different types of params", () => {
    const p = new Parser("fn add(a: i32, b: f32, c: Color, d: bool): i32 {}");
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "add");

    const params: [string, string][] = [
      ["a", "i32"],
      ["b", "f32"],
      ["c", "Color"],
      ["d", "bool"],
    ];

    assert(funcStmt.fnExpr.params.length === params.length);
    let i = 0;
    for (const [name, param] of params) {
      const literal = funcStmt.fnExpr.params[i].identifier
        .tokenLiteral()
        .toString();
      const type = funcStmt.fnExpr.params[0].type;
      assert(literal, name);
      assert(type, param);
      i++;
    }

    assert(funcStmt.fnExpr.returnType === "i32");
    assert(funcStmt.fnExpr.body.statements.length === 0);
  });

  test("can parse a function that returns", () => {
    const p = new Parser(`
    fn add(a: i32, b: i32): i32 {
      return a + b;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "add");
    assert(funcStmt.fnExpr.params.length === 2);
    const paramALiteral = funcStmt.fnExpr.params[0].identifier.tokenLiteral();
    const paramBLiteral = funcStmt.fnExpr.params[1].identifier.tokenLiteral();

    assert(paramALiteral === "a");
    assert(funcStmt.fnExpr.params[0].type === "i32");
    assert(paramBLiteral === "b");
    assert(funcStmt.fnExpr.params[1].type === "i32");

    assert(funcStmt.fnExpr.returnType === "i32");
    assert(funcStmt.fnExpr.body.statements.length === 1);

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
    const structStmt = ast.statements[0];
    assert(structStmt instanceof StructStatement);
    assert(structStmt.name === "S");
    assert(Object.keys(structStmt.members).length === 2);
    assert(!!structStmt.members["len"]);
    assert(!!structStmt.members["next"]);
    assert(structStmt.members["len"].name === "len");
    assert(structStmt.members["len"].offset === 0);
    assert(structStmt.members["len"].size === 4);
    assert(structStmt.members["len"].type === "i32");
    assert(structStmt.members["next"].name === "next");
    assert(structStmt.members["next"].offset === 4);
    assert(structStmt.members["next"].size === 4);
    assert(structStmt.members["next"].type === "f32");
  });

  test("can parse a struct definition (no trailing comma)", () => {
    const p = new Parser(`struct S {
      len: i32,
      next: f32
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);

    assert(ast.statements.length === 1);
    const structStmt = ast.statements[0];
    assert(structStmt instanceof StructStatement);
    assert(structStmt.name === "S");
    assert(Object.keys(structStmt.members).length === 2);
    assert(!!structStmt.members["len"]);
    assert(!!structStmt.members["next"]);
    assert(structStmt.members["len"].name === "len");
    assert(structStmt.members["len"].offset === 0);
    assert(structStmt.members["len"].size === 4);
    assert(structStmt.members["len"].type === "i32");
    assert(structStmt.members["next"].name === "next");
    assert(structStmt.members["next"].offset === 4);
    assert(structStmt.members["next"].size === 4);
    assert(structStmt.members["next"].type === "f32");
  });

  test("can parse a struct literal", () => {
    const p = new Parser(`
    struct S {
      len: i32,
      next: f32,
    }
    
    let s: S = {
      len = 10,
      next = 20.5,
    };`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 2);
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
    const p = new Parser(`fn test(): i32 {
      let x: i32 = 0;
      x = 5;
      return x;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 0);
    assert(funcStmt.fnExpr.returnType === "i32");
    assert(funcStmt.fnExpr.body.statements.length === 3);

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
    const p = new Parser(`fn test(): f32 {
      let x: f32 = 0.0;
      x = 3.1415;
      return x;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 0);
    assert(funcStmt.fnExpr.returnType === "f32");
    assert(funcStmt.fnExpr.body.statements.length === 3);

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
    const p = new Parser(`fn test(): bool {
      let x: bool = false;
      x = true;
      return x;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    assert(ast.statements.length === 1);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 0);
    assert(funcStmt.fnExpr.returnType === "bool");
    assert(funcStmt.fnExpr.body.statements.length === 3);

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
    const p = new Parser(`fn test(n: i32): i32 {
      let x: i32 = 0;
      if (n > 10) {
        x = 5;
      }
      return x;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 1);
    assert(funcStmt.fnExpr.returnType === "i32");
    assert(funcStmt.fnExpr.body.statements.length === 3);

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
    const p = new Parser(`fn test(n: i32): i32 {
      if (n > 10) {
        return 5;
      }
      return 0;
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 1);
    assert(funcStmt.fnExpr.returnType === "i32");
    assert(funcStmt.fnExpr.body.statements.length === 3);

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
    const p = new Parser(`fn test(n: i32): i32 {
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
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 1);
    assert(funcStmt.fnExpr.returnType === "i32");
    assert(funcStmt.fnExpr.body.statements.length === 3);

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
    const p = new Parser(`fn test(n: i32): i32 {
      if (n > 10) {
        return 5;
      } else {
        return 15;
      }
    }`);
    const ast = p.parse("test");
    console.log(p.errors);
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 1);
    assert(funcStmt.fnExpr.returnType === "i32");
    assert(funcStmt.fnExpr.body.statements.length === 1);

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
    const p = new Parser(`fn test(b: bool): i32 {
      if (b) {
        return 5;
      } else {
        return 15;
      }
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 1);
    assert(funcStmt.fnExpr.returnType === "i32");
    assert(funcStmt.fnExpr.body.statements.length === 1);

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
    const p = new Parser(`fn test(i: i32): i32 {
      if (i) {
        return 5;
      } else {
        return 15;
      }
    }`);
    const ast = p.parse("test");
    assert(p.errors.length === 0);
    const funcStmt = ast.statements[0];
    assert(funcStmt instanceof FunctionStatement);
    assert(funcStmt.name === "test");
    assert(funcStmt.fnExpr.params.length === 1);
    assert(funcStmt.fnExpr.returnType === "i32");
    assert(funcStmt.fnExpr.body.statements.length === 1);

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
});

const EPSILON = 0.00001;
function floatEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}
