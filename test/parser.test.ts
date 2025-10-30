import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Parser } from "../src/parser/Parser";
import { ImportStatement } from "../src/parser/ast/statements/ImportStatement";
import { FunctionStatement } from "../src/parser/ast/statements/FunctionStatement";

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

    console.log(funcStmt.fnExpr.params);
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

  // describe("error recovery", () => {
  //   test("reports missing delimiter in let statement", () => {
  //     assert(false);
  //   });

  //   test("collects multiple errors for missing semicolons", () => {
  //     assert(false);
  //   });
  // });

  // describe("expression precedence", () => {
  //   test("respects arithmetic precedence", () => {
  //     assert(false);
  //   });

  //   test("respects logical operator precedence", () => {
  //     assert(false);
  //   });

  //   test("binds pointer and member operations correctly", () => {
  //     assert(false);
  //   });

  //   test("supports chained call, index, and member expressions", () => {
  //     assert(false);
  //   });
  // });
});

const EPSILON = 0.00001;
function floatEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}
