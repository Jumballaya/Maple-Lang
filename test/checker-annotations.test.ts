import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { linkStdlibImports } from "../src/compiler/compiler";
import type { ModuleMeta } from "../src/compiler/emitters/emitter.types";
import { buildMergedAst, emitMergedProgram } from "../src/compiler/emitters/merge";
import { buildMergedProgram } from "../src/compiler/emitters/merge-model";
import { collectFnReferences, extractModuleMeta } from "../src/compiler/emitters/module";
import type { MapleError } from "../src/compiler/errors";
import type { ModuleGraph, ModuleRecord } from "../src/compiler/module-graph";
import { typeCheck } from "../src/compiler/TypeChecker";
import type { ASTProgram } from "../src/parser/ast/ASTProgram";
import { AssignmentExpression } from "../src/parser/ast/expressions/AssignmentExpression";
import { CallExpression } from "../src/parser/ast/expressions/CallExpression";
import { Identifier } from "../src/parser/ast/expressions/Identifier";
import { InfixExpression } from "../src/parser/ast/expressions/InfixExpression";
import { IntegerLiteralExpression } from "../src/parser/ast/expressions/IntegerLiteral";
import { PostfixExpression } from "../src/parser/ast/expressions/PostfixExpression";
import { ExpressionStatement } from "../src/parser/ast/statements/ExpressionStatement";
import { FunctionStatement } from "../src/parser/ast/statements/FunctionStatement";
import { LetStatement } from "../src/parser/ast/statements/LetStatement";
import { ReturnStatement } from "../src/parser/ast/statements/ReturnStatement";
import type { ASTExpression } from "../src/parser/ast/types/ast.type";
import { Parser } from "../src/parser/Parser";
import { maybeTest, runMergedExport } from "./helpers";

function checked(source: string): { ast: ASTProgram; errors: MapleError[] } {
  const parser = new Parser(source, "test.maple");
  const ast = parser.parse("test");
  assert.equal(
    parser.errors.length,
    0,
    `Parse errors: ${parser.errors.map((error) => error.message).join("; ")}`,
  );
  const meta = extractModuleMeta(ast, true);
  collectFnReferences(ast, meta);
  linkStdlibImports(meta);
  return { ast, errors: typeCheck(ast, meta) };
}

function errorMessages(source: string): string[] {
  return checked(source).errors.map((error) => error.message);
}

function onlyFunction(ast: ASTProgram): FunctionStatement {
  const fn = ast.statements.find((statement) => statement instanceof FunctionStatement);
  assert(fn instanceof FunctionStatement);
  return fn;
}

function annotation(expression: ASTExpression): ASTExpression {
  return expression;
}

function parsedModule(source: string, name: string): { ast: ASTProgram; meta: ModuleMeta } {
  const parser = new Parser(source, `${name}.maple`);
  const ast = parser.parse(name);
  assert.deepEqual(parser.errors, []);
  const meta = extractModuleMeta(ast, true);
  collectFnReferences(ast, meta);
  return { ast, meta };
}

function linkedProject(): ModuleGraph {
  const dependency = parsedModule(
    `
      export struct Pair { value: i32 }
      export let shared: Pair = { value = 4 };
      export fn helper(pair: Pair): Pair { return pair; }
    `,
    "dep",
  );
  const entry = parsedModule(
    `
      import Pair, shared, helper from "./dep.maple"
      export fn run(pair: Pair): i32 {
        let local: Pair = helper(pair);
        let ref: fn(Pair):Pair = helper;
        return local.value + shared.value;
      }
    `,
    "main",
  );

  for (const name of ["Pair", "shared", "helper"]) {
    const imported = entry.meta.imports[name]!;
    imported.info = dependency.meta.exports[name];
    imported.resolved = true;
    imported.mergeable = true;
  }
  entry.meta.imports.Pair!.typeIdentity = "dep$$Pair";
  entry.meta.imports.Pair!.structMeta = {
    ...dependency.meta.structs.Pair!,
    name: "dep$$Pair",
  };
  entry.meta.imports.shared!.mapleType = "dep$$Pair";
  entry.meta.imports.helper!.mapleParams = ["dep$$Pair"];
  entry.meta.imports.helper!.mapleResults = ["dep$$Pair"];

  const dependencyRecord: ModuleRecord = {
    kind: "maple",
    key: "dep",
    manglePrefix: "dep",
    filePath: "/tmp/maple-t26/dep.maple",
    ast: dependency.ast,
    data: dependency.meta,
    dependencies: [],
  };
  const entryRecord: ModuleRecord = {
    kind: "maple",
    key: "main",
    manglePrefix: "main",
    filePath: "/tmp/maple-t26/main.maple",
    ast: entry.ast,
    data: entry.meta,
    dependencies: [{ kind: "maple", specifier: "./dep.maple", key: "dep" }],
  };
  return {
    entryKey: "main",
    modules: new Map([
      ["main", entryRecord],
      ["dep", dependencyRecord],
    ]),
    externals: [],
  };
}

describe("TypeChecker: resolved annotations", () => {
  test("stamps adopted literal, identifier, infix, postfix, and call types", () => {
    const { ast, errors } = checked(`
      fn identity(value: u32): u32 { return value; }
      fn run(): u32 {
        let value: u32 = 5;
        let sum: u32 = 1 + value;
        let old: u32 = value++;
        identity(value);
        return sum;
      }
    `);
    assert.deepEqual(errors, []);

    const run = ast.statements[1];
    assert(run instanceof FunctionStatement);
    const valueLet = run.fnExpr.body.statements[0];
    const sumLet = run.fnExpr.body.statements[1];
    const oldLet = run.fnExpr.body.statements[2];
    const callStmt = run.fnExpr.body.statements[3];
    assert(valueLet instanceof LetStatement);
    assert(sumLet instanceof LetStatement);
    assert(oldLet instanceof LetStatement);
    assert(callStmt instanceof ExpressionStatement);
    assert(valueLet.expression instanceof IntegerLiteralExpression);
    assert(sumLet.expression instanceof InfixExpression);
    assert(oldLet.expression instanceof PostfixExpression);
    assert(callStmt.expression instanceof CallExpression);

    assert.equal(annotation(valueLet.expression).resolvedType, "u32");
    assert.equal(annotation(sumLet.expression.left).resolvedType, "u32");
    assert.equal(annotation(sumLet.expression.right).resolvedType, "u32");
    assert.equal(annotation(sumLet.expression).resolvedType, "u32");
    assert.equal(annotation(oldLet.expression).resolvedType, "u32");
    assert.deepEqual(annotation(callStmt.expression).resolvedResultTypes, ["u32"]);
    assert.equal(annotation(callStmt.expression).resolvedType, "u32");
    assert.deepEqual(annotation(callStmt.expression).resolvedCallTarget, { kind: "decl" });
    assert.deepEqual(annotation(callStmt.expression).resolvedDecl, {
      kind: "function",
      name: "identity",
    });
  });

  test("calls record zero, one, and multiple result shapes", () => {
    const { ast, errors } = checked(`
      fn none(): void {}
      fn one(): i32 { return 1; }
      fn many(): (i32, f32) { return 1, 2.0; }
      fn run(): i32 {
        none();
        one();
        many();
        let (a, b) = many();
        return a;
      }
    `);
    assert.deepEqual(errors, []);
    const run = ast.statements[3];
    assert(run instanceof FunctionStatement);
    const calls = run.fnExpr.body.statements.slice(0, 3).map((statement) => {
      assert(statement instanceof ExpressionStatement);
      assert(statement.expression instanceof CallExpression);
      return statement.expression;
    });
    assert.deepEqual(annotation(calls[0]!).resolvedResultTypes, []);
    assert.equal(annotation(calls[0]!).resolvedType, undefined);
    assert.deepEqual(annotation(calls[1]!).resolvedResultTypes, ["i32"]);
    assert.equal(annotation(calls[1]!).resolvedType, "i32");
    assert.deepEqual(annotation(calls[2]!).resolvedResultTypes, ["i32", "f32"]);
    assert.equal(annotation(calls[2]!).resolvedType, undefined);
  });

  test("declaration descriptors distinguish locals, params, globals, functions, and intrinsics", () => {
    const { ast, errors } = checked(`
      let global: i32 = 1;
      fn helper(): i32 { return 2; }
      fn run(param: i32): i32 {
        let local: i32 = param;
        let loaded: i32 = __load_i32(65536);
        return local + global + helper() + loaded;
      }
    `);
    assert.deepEqual(errors, []);
    const run = ast.statements[2];
    assert(run instanceof FunctionStatement);
    const localLet = run.fnExpr.body.statements[0];
    const loadedLet = run.fnExpr.body.statements[1];
    const returnStmt = run.fnExpr.body.statements[2];
    assert(localLet instanceof LetStatement);
    assert(localLet.expression instanceof Identifier);
    assert.deepEqual(annotation(localLet.expression).resolvedDecl, {
      kind: "param",
      name: "param",
    });
    assert(loadedLet instanceof LetStatement);
    assert(loadedLet.expression instanceof CallExpression);
    assert.deepEqual(annotation(loadedLet.expression).resolvedDecl, {
      kind: "intrinsic",
      name: "__load_i32",
    });
    assert(returnStmt instanceof ReturnStatement);
    const serialized = JSON.stringify(returnStmt);
    assert.match(serialized, /"kind":"local","name":"local"/);
    assert.match(serialized, /"kind":"global","name":"global"/);
    assert.match(serialized, /"kind":"function","name":"helper"/);
  });

  test("statement mutations are effects while value postfix remains a value", () => {
    const { ast, errors } = checked(`
      fn run(): i32 {
        let x: i32 = 1;
        x = 2;
        x++;
        let old: i32 = x++;
        return old;
      }
    `);
    assert.deepEqual(errors, []);
    const fn = onlyFunction(ast);
    const assignmentStmt = fn.fnExpr.body.statements[1];
    const postfixStmt = fn.fnExpr.body.statements[2];
    const oldLet = fn.fnExpr.body.statements[3];
    assert(assignmentStmt instanceof ExpressionStatement);
    assert(assignmentStmt.expression instanceof AssignmentExpression);
    assert.equal(annotation(assignmentStmt.expression).resolvedType, undefined);
    assert(postfixStmt instanceof ExpressionStatement);
    assert(postfixStmt.expression instanceof PostfixExpression);
    assert.equal(annotation(postfixStmt.expression).resolvedType, undefined);
    assert(oldLet instanceof LetStatement);
    assert(oldLet.expression instanceof PostfixExpression);
    assert.equal(annotation(oldLet.expression).resolvedType, "i32");
  });

  test("annotates fn-typed calls through locals and params with lexical precedence", () => {
    const { ast, errors } = checked(`
      fn op(value: i32): i32 { return 100; }
      fn plusOne(value: i32): i32 { return value + 1; }
      fn invoke(op: fn(i32):i32, value: i32): i32 { return op(value); }
      fn run(): i32 {
        let op: fn(i32):i32 = plusOne;
        return op(4) + invoke(op, 5);
      }
    `);
    assert.deepEqual(errors, []);

    const invoke = ast.statements[2];
    const run = ast.statements[3];
    assert(invoke instanceof FunctionStatement);
    assert(run instanceof FunctionStatement);
    const invokeReturn = invoke.fnExpr.body.statements[0];
    const runReturn = run.fnExpr.body.statements[1];
    assert(invokeReturn instanceof ReturnStatement);
    assert(runReturn instanceof ReturnStatement);
    const paramCall = invokeReturn.returnValues[0];
    assert(paramCall instanceof CallExpression);
    assert.deepEqual(annotation(paramCall).resolvedDecl, { kind: "param", name: "op" });
    assert.equal(annotation(paramCall.args[0]!).resolvedType, "i32");

    const sum = runReturn.returnValues[0];
    assert(sum instanceof InfixExpression);
    assert(sum.left instanceof CallExpression);
    assert.deepEqual(annotation(sum.left).resolvedDecl, { kind: "local", name: "op" });
    assert.deepEqual(annotation(sum.left).resolvedResultTypes, ["i32"]);
  });

  test("distinguishes fn-typed struct fields from methods", () => {
    const fieldProgram = checked(`
      struct Handler { cb: fn(i32):i32 }
      fn plusOne(value: i32): i32 { return value + 1; }
      fn run(): i32 {
        let handler: Handler = { cb = plusOne };
        return handler.cb(4);
      }
    `);
    assert.deepEqual(fieldProgram.errors, []);
    const fieldRun = fieldProgram.ast.statements[2];
    assert(fieldRun instanceof FunctionStatement);
    const actualFieldReturn = fieldRun.fnExpr.body.statements[1];
    assert(actualFieldReturn instanceof ReturnStatement);
    const fieldCall = actualFieldReturn.returnValues[0];
    assert(fieldCall instanceof CallExpression);
    assert.deepEqual(annotation(fieldCall).resolvedCallTarget, {
      kind: "field",
      receiverArg: 0,
      structIdentity: "Handler",
      member: "cb",
      fnType: "fn(i32):i32",
    });
    assert.equal(annotation(fieldCall).resolvedDecl, undefined);

    const methodProgram = checked(`
      struct Counter { value: i32 }
      fn Counter.read(self)(): i32 { return self.value; }
      fn run(): i32 {
        let counter: Counter = { value = 7 };
        return counter.read();
      }
    `);
    assert.deepEqual(methodProgram.errors, []);
    const methodRun = methodProgram.ast.statements[2];
    assert(methodRun instanceof FunctionStatement);
    const methodReturn = methodRun.fnExpr.body.statements[1];
    assert(methodReturn instanceof ReturnStatement);
    const methodCall = methodReturn.returnValues[0];
    assert(methodCall instanceof CallExpression);
    assert.deepEqual(annotation(methodCall).resolvedCallTarget, { kind: "decl" });
    assert.deepEqual(annotation(methodCall).resolvedDecl, {
      kind: "function",
      name: "Counter_read",
    });
  });

  test("uses defining-module identities for imported values and functions", () => {
    const graph = linkedProject();
    const dependency = graph.modules.get("dep")!;
    const entry = graph.modules.get("main")!;
    assert.deepEqual(typeCheck(dependency.ast, dependency.data), []);
    assert.deepEqual(typeCheck(entry.ast, entry.data), []);

    const run = onlyFunction(entry.ast);
    const localLet = run.fnExpr.body.statements[0];
    const refLet = run.fnExpr.body.statements[1];
    const returnStmt = run.fnExpr.body.statements[2];
    assert(localLet instanceof LetStatement);
    assert(localLet.expression instanceof CallExpression);
    assert.equal(annotation(localLet.expression).resolvedType, "dep$$Pair");
    assert.deepEqual(annotation(localLet.expression).resolvedDecl, {
      kind: "import",
      name: "helper",
    });
    assert(refLet instanceof LetStatement);
    assert(refLet.expression instanceof Identifier);
    assert.equal(annotation(refLet.expression).resolvedType, "fn(dep$$Pair):dep$$Pair");
    assert.deepEqual(annotation(refLet.expression).resolvedDecl, {
      kind: "import",
      name: "helper",
    });
    assert(returnStmt instanceof ReturnStatement);
    assert.match(JSON.stringify(returnStmt), /"kind":"import","name":"shared"/);
    assert.match(JSON.stringify(returnStmt), /"resolvedType":"dep\$\$Pair"/);
  });

  test("rewrites annotations and import provenance in the merged clone", () => {
    const graph = linkedProject();
    for (const module of graph.modules.values()) {
      assert.deepEqual(typeCheck(module.ast, module.data), []);
    }
    const merged = buildMergedAst(buildMergedProgram(graph));
    const run = merged.statements.find(
      (statement) => statement instanceof FunctionStatement && statement.name === "main$$run",
    );
    assert(run instanceof FunctionStatement);
    const serialized = JSON.stringify(run);
    assert.match(serialized, /"resolvedType":"dep\$\$Pair"/);
    assert.match(serialized, /"kind":"function","name":"dep\$\$helper"/);
    assert.match(serialized, /"kind":"global","name":"dep\$\$shared"/);
    assert.match(serialized, /"kind":"local","name":"local"/);
    assert.match(serialized, /"kind":"param","name":"pair"/);
    assert.doesNotMatch(serialized, /"kind":"import"/);
  });

  test("annotations do not change merged WAT emission", () => {
    const graph = linkedProject();
    const entryRun = onlyFunction(graph.modules.get("main")!.ast);
    entryRun.fnExpr.body.statements.splice(1, 1);
    const before = emitMergedProgram(buildMergedProgram(graph));
    for (const module of graph.modules.values()) {
      assert.deepEqual(typeCheck(module.ast, module.data), []);
    }
    const after = emitMergedProgram(buildMergedProgram(graph));
    assert.equal(after, before);
  });
});

describe("TypeChecker: annotation totality diagnostics", () => {
  const cases = [
    ["fn run(): i32 { return missing(); }", "Undefined function 'missing'"],
    [
      "fn run(): void { let f: fn(i32):i32 = fn(x: i32): i32 { return x; }; }",
      "function literals are not supported yet",
    ],
    [
      "struct P { x: i32 } fn take(p: P): void {} fn run(): void { take({ x = 1 }); }",
      "struct literals are only supported as initializers",
    ],
    [
      "struct P { x: i32 } fn run(): i32 { let p: P = { x = 1 }; return p.x++; }",
      "value-position increment requires a plain variable",
    ],
    ["fn run(): void { 5; }", "expression statement has no effect"],
    ["fn run(): void { let x: i32 = 1; x + 1; }", "expression statement has no effect"],
    ["fn run(): i32 { let x: i32 = 1; return x.len; }", "type 'i32' has no members"],
    ["fn run(): i32 { let x: i32 = 1; return x[0]; }", "type 'i32' is not indexable"],
    [
      "fn run(): i32 { let a: i32[] = [1]; let i: f32 = 0.0; return a[i]; }",
      "array index must be an i32-lane value",
    ],
    ["fn run(): i32 { let x: i32 = 1; return x as Banana; }", "unknown type 'Banana'"],
    ["fn run(): i32 {}", "function 'run' must return 'i32' on all paths"],
    ["fn run(): void { let x: i32 = 1; let y: i32 = (x = 2); }", "assignment is a statement"],
    ["fn run(): void { let x: i32 = 1; 2 = x; }", "invalid assignment target"],
    ["fn value(): void {} fn run(): i32 { return value() + 1; }", "void call used as a value"],
    ["fn run(): i32 { let x: f32 = 1.0; return ~x; }", "operator '~' requires integer operands"],
    [
      "fn run(): void { for (let i: i32 = 0; i < 1; i + 1) {} }",
      "expression statement has no effect",
    ],
  ] as const;

  for (const [source, expected] of cases) {
    test(expected, () => {
      assert(
        errorMessages(source).includes(expected),
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(errorMessages(source))}`,
      );
    });
  }

  test("a let initializer resolves before its new binding enters scope", () => {
    const errors = errorMessages(`
      fn run(): void {
        let x: i32 = 1;
        let x: f32 = x;
      }
    `);
    assert(errors.includes("Type mismatch: cannot assign 'i32' to 'f32'"));
  });

  test("rejects unknown annotations in every declaration shape", () => {
    const sources = [
      "let value: Banana = 1;",
      "fn run(): void { let value: Banana = 1; }",
      "fn run(value: Banana): void {}",
      "fn run(): Banana { return 1; }",
      "struct Box { value: Banana }",
      "fn run(): void { let values: Banana[] = [1]; }",
      "fn known(value: i32): i32 { return value; } fn run(): void { let cb: fn(Banana):i32 = known; }",
    ];
    for (const source of sources) {
      assert(
        errorMessages(source).includes("unknown type 'Banana'"),
        `Missing unknown-type error for ${source}`,
      );
    }
  });

  test("keeps every i32-lane scalar legal as an array index", () => {
    const { errors } = checked(`
      fn run(values: i32[], a: u8, b: u32, flag: bool): i32 {
        return values[a] + values[b] + values[flag];
      }
    `);
    assert.deepEqual(errors, []);
  });

  test("rejects every non-i32 array index lane", () => {
    for (const [type, value] of [
      ["i64", "0 as i64"],
      ["u64", "0 as u64"],
      ["f32", "0.0"],
      ["f64", "0.0 as f64"],
    ]) {
      const errors = errorMessages(
        `fn run(): i32 { let values: i32[] = [1]; let index: ${type} = ${value}; return values[index]; }`,
      );
      assert(errors.includes("array index must be an i32-lane value"));
    }
  });

  test("pins assignment and mutation diagnostics", () => {
    assert(
      errorMessages("fn run(): void { let x: i32 = 1; x = 1.0; }").includes(
        "Type mismatch: cannot assign 'f32' to 'i32'",
      ),
    );
    assert(
      errorMessages("fn run(): void { const x: i32 = 1; x += 1; }").includes(
        "Cannot assign to constant 'x'",
      ),
    );
    assert(
      errorMessages("fn run(): void { const x: i32 = 1; x++; }").includes(
        "Cannot assign to constant 'x'",
      ),
    );
    assert(
      errorMessages('fn run(): void { let value: string = "x"; value++; }').includes(
        "operator '++' requires numeric operands",
      ),
    );
    assert(
      errorMessages("fn run(): void { let value: f32 = 1.0; value &= 1.0; }").includes(
        "operator '&' requires integer operands",
      ),
    );
  });

  test("allows supported member and index mutations in statement position", () => {
    const { errors } = checked(`
      struct Point { x: i32 }
      fn run(): i32 {
        let point: Point = { x = 1 };
        let values: i32[] = [2];
        point.x++;
        point.x += 2;
        values[0]++;
        return point.x + values[0];
      }
    `);
    assert.deepEqual(errors, []);
  });

  test("rejects partial-return bodies and void calls in all value contexts", () => {
    assert(
      errorMessages("fn run(flag: bool): i32 { if (flag) { return 1; } }").includes(
        "function 'run' must return 'i32' on all paths",
      ),
    );
    for (const expression of ["value() + 1", "value() == value()", "value() as i32"]) {
      assert(
        errorMessages(`fn value(): void {} fn run(): i32 { return ${expression}; }`).includes(
          "void call used as a value",
        ),
      );
    }
  });

  test("rejects an unresolvable synthetic member call", () => {
    const errors = errorMessages(`
      struct Box { value: i32 }
      fn run(): i32 {
        let box: Box = { value = 1 };
        return box.missing();
      }
    `);
    assert(errors.includes("Undefined function 'Box_missing'"));
  });
});

maybeTest("fn-typed local and param calls compose as binary operands", async () => {
  const result = await runMergedExport(
    `
      fn add(a: i32, b: i32): i32 { return a + b; }
      fn foo(value: i32): i32 { return value + 1; }
      fn invoke(op: fn(i32,i32):i32): i32 { return op(1, 2) + foo(4); }
      export fn run(): i32 {
        let op: fn(i32,i32):i32 = add;
        return op(1, 2) + foo(4) + invoke(add);
      }
    `,
    "run",
  );
  assert.equal(result, 16);
});
