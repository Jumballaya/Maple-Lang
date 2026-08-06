import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { linkStdlibImports } from "../src/compiler/compiler";
import type { ModuleMeta } from "../src/compiler/metadata";
import { collectFnReferences, extractModuleMeta } from "../src/compiler/module-metadata";
import { typeCheck } from "../src/compiler/TypeChecker";
import { structLayout } from "../src/ir/layout";
import { lowerModule } from "../src/ir/lower";
import { printWat } from "../src/ir/print-wat";
import { validateModule } from "../src/ir/validate";
import type { ASTProgram } from "../src/parser/ast/ASTProgram";
import { StructLiteralExpression } from "../src/parser/ast/expressions/StructLiteralExpression";
import { LetStatement } from "../src/parser/ast/statements/LetStatement";
import { StructStatement } from "../src/parser/ast/statements/StructStatement";
import { Parser } from "../src/parser/Parser";
import { runExport } from "./helpers";

type CheckedProgram = { ast: ASTProgram; meta: ModuleMeta };

function checked(source: string): CheckedProgram {
  const parser = new Parser(source, "memory.maple");
  const ast = parser.parse("memory");
  assert.deepEqual(
    parser.errors.map((error) => error.message),
    [],
  );
  const meta = extractModuleMeta(ast, true);
  collectFnReferences(ast, meta);
  linkStdlibImports(meta);
  assert.deepEqual(
    typeCheck(ast, meta).map((error) => error.message),
    [],
  );
  return { ast, meta };
}

function lowered(source: string): ReturnType<typeof lowerModule> & { wat: string } {
  const { ast, meta } = checked(source);
  const result = lowerModule(ast, meta, { importMemory: false });
  assert.deepEqual(validateModule(result.module), []);
  return {
    ...result,
    wat: printWat(result.module),
  };
}

function differential(source: string, exportName: string, args: (number | bigint)[] = []): unknown {
  return runExport(lowered(source).module, exportName, args);
}

function fixed(source: string, exportName: string, args: (number | bigint)[] = []): unknown {
  const { ast, meta } = checked(source);
  const result = lowerModule(ast, meta, { importMemory: false });
  assert.deepEqual(validateModule(result.module), []);
  return runExport(result.module, exportName, args);
}

describe("IR memory lowering: layout and frames", () => {
  test("freezes mixed-width struct layouts independently of the parser", () => {
    const { ast } = checked(`
      struct Mixed { byte: i8, wide: i64, half: i16, tail: u8 }
      struct Reverse { half: i16, byte: u8, wide: u64 }
      fn unused(): void {}
    `);
    const structs = ast.statements.filter(
      (statement): statement is StructStatement => statement instanceof StructStatement,
    );
    assert.deepEqual(
      structs.map((statement) => {
        const layout = structLayout(statement.members);
        return {
          name: statement.name,
          size: layout.size,
          offsets: layout.members.map(({ name, offset }) => ({ name, offset })),
        };
      }),
      [
        {
          name: "Mixed",
          size: 24,
          offsets: [
            { name: "byte", offset: 0 },
            { name: "wide", offset: 8 },
            { name: "half", offset: 16 },
            { name: "tail", offset: 18 },
          ],
        },
        {
          name: "Reverse",
          size: 16,
          offsets: [
            { name: "half", offset: 0 },
            { name: "byte", offset: 2 },
            { name: "wide", offset: 8 },
          ],
        },
      ],
    );
  });

  test("isolates recursive frames and restores on early return", () => {
    const source = `
      struct Box { value: i32 }
      fn digits(n: i32): i32 {
        let box: Box = { value = n };
        if (n == 0) { return box.value; }
        let child: i32 = digits(n - 1);
        return box.value * 10 + child;
      }
      fn early(n: i32): i32 {
        let box: Box = { value = n };
        if (n > 0) { return box.value; }
        return 0;
      }
      export fn run(): i32 {
        let total: i32 = 0;
        for (let i: i32 = 0; i < 100; i++) { total += early(i + 1); }
        return digits(3) + total;
      }
    `;
    assert.equal(differential(source, "run"), 5110);
  });
});

describe("IR memory lowering: arrays", () => {
  test("evaluates dynamic elements left to right once per declaration execution", () => {
    const source = `
      let trace: i32 = 0;
      fn mark(value: i32): i32 { trace = trace * 10 + value; return value; }
      fn build(): i32 {
        let values: i32[] = [mark(1), mark(2)];
        let result: i32 = values[0] * 10 + values[1];
        values[0] = 9;
        values[1] = 9;
        return result;
      }
      export fn run(): i32 {
        let first: i32 = build();
        let second: i32 = build();
        return trace * 10000 + first * 100 + second;
      }
    `;
    assert.equal(fixed(source, "run"), 12_121_212);
  });

  test("reinitializes every slot of a mixed dynamic array", () => {
    const source = `
      fn middle(): i32 { return 2; }
      fn build(): i32 {
        let values: i32[] = [1, middle(), 3];
        let result: i32 = values[0] * 100 + values[1] * 10 + values[2];
        values[0] = 8;
        values[1] = 8;
        values[2] = 8;
        return result;
      }
      export fn run(): i32 { return build() * 1000 + build(); }
    `;
    assert.equal(fixed(source, "run"), 123_123);
  });

  test("stores runtime u8 and i16 elements with their declared widths", () => {
    const source = `
      fn byte(value: u8): u8 { return value; }
      fn half(value: i16): i16 { return value; }
      export fn run(): i32 {
        let bytes: u8[] = [byte(250), 1];
        let halves: i16[] = [half(-1234), 2];
        return (bytes[0] as i32) * 10000 + halves[0];
      }
    `;
    assert.equal(fixed(source, "run"), 2_498_766);
  });

  test("stores dynamic string and struct-reference elements", () => {
    const source = `
      struct Pair { value: i32 }
      export fn run(): i32 {
        let text: string = "same";
        let strings: string[] = ["same", text];
        let first: Pair = { value = 4 };
        let second: Pair = { value = 7 };
        let pairs: Pair[] = [first, second];
        return (strings[0] == strings[1]) * 100 + pairs[0].value * 10 + pairs[1].value;
      }
    `;
    assert.equal(fixed(source, "run"), 147);
  });

  test("runs dynamic array stores in return, argument, and inline-index positions", () => {
    const source = `
      let trace: i32 = 0;
      fn mark(value: i32): i32 { trace = trace * 10 + value; return value; }
      fn returned(): i32[] { return [1, mark(2)]; }
      fn take(values: i32[]): i32 { return values[1]; }
      fn inline(): i32 { return [5, mark(6)][1]; }
      export fn run(): i32 {
        let fromReturn: i32 = returned()[1];
        let fromArgument: i32 = take([3, mark(4)]);
        let inlineIndex: i32 = inline();
        let ordered: i32 = mark(7) + [0, mark(8)][1];
        return trace * 100 + fromReturn + fromArgument + inlineIndex + ordered;
      }
    `;
    assert.equal(fixed(source, "run"), 2_467_827);
  });

  test("keeps dynamic array stores inside short-circuited expressions", () => {
    const source = `
      let trace: i32 = 0;
      fn mark(): i32 { trace++; return 1; }
      export fn run(flag: i32): i32 {
        if (flag && [0, mark()][1]) {}
        return trace;
      }
    `;
    const { module } = lowered(source);
    assert.equal(runExport(module, "run", [0]), 0);
    assert.equal(runExport(module, "run", [1]), 1);
  });

  // T71 / decision O10: a non-escaping local literal is per-call now, so the
  // second call sees the initializer again instead of the first call's writes.
  // This test previously pinned the shared-buffer quirk (12).
  test("gives a non-escaping local literal fresh storage per call", () => {
    const source = `
      fn touch(): i32 {
        let values: i32[] = [1];
        let old: i32 = values[0];
        values[0] = old + 1;
        return old;
      }
      export fn run(): i32 { return touch() * 10 + touch(); }
    `;
    assert.equal(differential(source, "run"), 11);
  });

  // An ESCAPING literal keeps static storage, which is what makes returning
  // one legal at all — the gap that blocked plain option A.
  test("an escaping local literal keeps static storage and is still returnable", () => {
    const source = `
      fn build(): i32[] {
        let values: i32[] = [1, 2];
        return values;
      }
      export fn run(): i32 { let v: i32[] = build(); return v[0] * 10 + v[1]; }
    `;
    assert.equal(differential(source, "run"), 12);
  });

  test("traps negative, length, and huge indices", () => {
    const { module } = lowered(`
      export fn read(i: i32): i32 { let values: i32[] = [4, 5]; return values[i]; }
    `);
    assert.equal(runExport(module, "read", [1]), 5);
    for (const index of [-1, 2, 2_000_000_000]) {
      assert.throws(() => runExport(module, "read", [index]), WebAssembly.RuntimeError);
    }
  });

  test("round-trips every scalar element lane and sub-word width", () => {
    const source = `
      export fn i8v(): i32 { let a: i8[] = [0]; a[0] = -5; return a[0]; }
      export fn u8v(): i32 { let a: u8[] = [0]; a[0] = 250; return a[0]; }
      export fn i16v(): i32 { let a: i16[] = [0]; a[0] = -1234; return a[0]; }
      export fn u16v(): i32 { let a: u16[] = [0]; a[0] = 60000; return a[0]; }
      export fn i32v(): i32 { let a: i32[] = [0]; a[0] = -123456; return a[0]; }
      export fn u32v(): u32 { let a: u32[] = [0]; a[0] = 4000000000; return a[0]; }
      export fn i64v(): i64 { let a: i64[] = [0]; a[0] = -123456789 as i64; return a[0]; }
      export fn u64v(): u64 { let a: u64[] = [0]; a[0] = 123456789 as u64; return a[0]; }
      export fn f32v(): f32 { let a: f32[] = [0.0]; a[0] = 1.25; return a[0]; }
      export fn f64v(): f64 { let a: f64[] = [0.0]; a[0] = 2.5 as f64; return a[0]; }
      export fn boolv(): bool { let a: bool[] = [false]; a[0] = true; return a[0]; }
    `;
    const expected: Record<string, number | bigint> = {
      i8v: -5,
      u8v: 250,
      i16v: -1234,
      u16v: 60000,
      i32v: -123456,
      u32v: -294967296,
      i64v: -123456789n,
      u64v: 123456789n,
      f32v: 1.25,
      f64v: 2.5,
      boolv: 1,
    };
    for (const [name, value] of Object.entries(expected)) {
      assert.equal(differential(source, name), value);
    }
  });

  test("lowers arbitrary bases and every index mutation once", () => {
    const source = `
      struct Bag { values: i32[] }
      let calls: i32 = 0;
      fn index(): i32 { calls++; return 1; }
      fn get(values: i32[]): i32[] { calls++; return values; }
      export fn run(): i32 {
        let bag: Bag = { values = [3, 4] };
        bag.values[index()] += 2;
        bag.values[index()]++;
        get(bag.values)[0]++;
        return calls * 100 + bag.values[0] * 10 + bag.values[1];
      }
    `;
    assert.equal(fixed(source, "run"), 347);
  });

  test("captures an indexed address before evaluating the rhs", () => {
    const source = `
      let trace: i32 = 0;
      fn index(): i32 { trace = trace * 10 + 1; return 0; }
      fn rhs(): i32 { trace = trace * 10 + 2; return 2; }
      export fn run(): i32 {
        let values: i32[] = [1];
        values[index()] += rhs();
        return trace * 10 + values[0];
      }
    `;
    assert.equal(fixed(source, "run"), 123);
  });

  test("handles inline, returned, member, and call-result array bases", () => {
    const source = `
      struct Bag { values: i32[] }
      fn values(): i32[] { return [7, 8]; }
      fn length(values: i32[]): i32 { return values.len; }
      export fn run(): i32 {
        let bag: Bag = { values = [3, 4] };
        return [1, 2][0] * 10000 + bag.values[1] * 1000 + values()[1] * 100
          + [5, 6].len * 10 + values().data / values().data;
      }
    `;
    assert.equal(fixed(source, "run"), 14_821);
  });
});

describe("IR memory lowering: strings", () => {
  test("does not intern literals and compares their contents", () => {
    const source = `
      export fn distinct(): i32 {
        let a: string = "same";
        let b: string = "same";
        return a.data != b.data;
      }
      export fn equal(): i32 { return "same" == "same"; }
      export fn unequal(): i32 { return "a" == "b"; }
    `;
    assert.equal(differential(source, "distinct"), 1);
    assert.equal(fixed(source, "equal"), 1);
    assert.equal(fixed(source, "unequal"), 0);
  });

  test("allocates literals in returns, nested calls, and infix expressions", () => {
    const source = `
      fn text(): string { return "hello"; }
      fn same(value: string): i32 { return value == "hello"; }
      export fn run(): i32 { return same(text()) * 10 + same("hello"); }
    `;
    assert.equal(fixed(source, "run"), 11);
  });

  test("reads string arrays and delegates element equality", () => {
    const source = `
      export fn run(): i32 {
        let values: string[] = ["x", "x"];
        return values[0] == values[1];
      }
    `;
    assert.equal(differential(source, "run"), 1);
  });
});

describe("IR memory lowering: structs", () => {
  test("copies struct pointers on assignment", () => {
    const source = `
      struct Pair { x: i32, y: i32 }
      export fn run(): i32 {
        let p: Pair = { x = 7, y = 8 };
        let q: Pair = p;
        q.x = 1;
        return p.x;
      }
    `;
    assert.equal(differential(source, "run"), 1);
  });

  test("evaluates literal fields in declaration order", () => {
    const source = `
      struct Pair { first: i32, second: i32 }
      let order: i32 = 0;
      fn mark(value: i32): i32 { order = order * 10 + value; return value; }
      export fn run(): i32 {
        let pair: Pair = { second = mark(2), first = mark(1) };
        return order * 100 + pair.first * 10 + pair.second;
      }
    `;
    assert.equal(differential(source, "run"), 1212);
  });

  test("supports array and string fields plus member mutations", () => {
    const source = `
      struct Record { small: i8, name: string, values: i32[] }
      export fn run(): i32 {
        let record: Record = { values = [4, 5], name = "ok", small = 2 };
        record.small += 3;
        record.small++;
        record.values[1] += 2;
        return record.small * 100 + record.name.len * 10 + record.values[1];
      }
    `;
    assert.equal(fixed(source, "run"), 627);
  });

  test("reads call-result members and mutates through a parameter alias", () => {
    const source = `
      struct Pair { left: i32, right: i32 }
      fn get(pair: Pair): Pair { return pair; }
      fn mutate(pair: Pair): i32 {
        let alias: Pair = pair;
        alias.left += 2;
        alias.left++;
        return pair.left;
      }
      export fn run(): i32 {
        let pair: Pair = { left = 4, right = 9 };
        return get(pair).right * 10 + mutate(pair);
      }
    `;
    assert.equal(differential(source, "run"), 97);
  });

  test("keeps plain indexed postfix differential", () => {
    const source = `
      export fn run(): i32 {
        let values: i32[] = [4];
        let index: i32 = 0;
        values[index]++;
        return values[0];
      }
    `;
    assert.equal(differential(source, "run"), 5);
  });

  test("closes nested equality over string-bearing members", () => {
    const source = `
      struct Inner { name: string, value: i16 }
      struct Outer { inner: Inner, tag: u8 }
      export fn run(): i32 {
        let leftInner: Inner = { name = "same", value = 9 };
        let rightInner: Inner = { name = "same", value = 9 };
        let left: Outer = { inner = leftInner, tag = 1 };
        let right: Outer = { inner = rightInner, tag = 1 };
        return left == right;
      }
    `;
    const result = lowered(source);
    assert.equal(runExport(result.module, "run"), 1);
    const helperNames = new Set(result.module.names.funcs.values());
    assert(helperNames.has("__struct_eq_Outer"));
    assert(helperNames.has("__struct_eq_Inner"));
    assert(helperNames.has("__string_eq"));
  });

  test("reads and writes all i32-backed field kinds", () => {
    const source = `
      struct Holder { callback: fn(i32): i32, value: i32 }
      export fn run(callback: fn(i32): i32): i32 {
        let holder: Holder = { callback = callback, value = 0 };
        let read: fn(i32): i32 = holder.callback;
        return read == callback;
      }
    `;
    const result = lowered(source);
    assert.equal(runExport(result.module, "run", [123]), 1);
  });

  test("encodes aggregate fields of global structs directly", () => {
    const source = `
      struct Global { values: i32[], name: string }
      let global: Global = { values = [8, 9], name = "g" };
      export fn run(): i32 { return global.values[1] * 10 + global.name.len; }
    `;
    assert.equal(fixed(source, "run"), 91);
  });
});

describe("IR memory lowering: startup initializers and helper demand", () => {
  test("initializes module-scope dynamic arrays through start", () => {
    const source = `
      let trace: i32 = 0;
      fn seed(): i32 { trace = trace + 1; return 4; }
      let values: i32[] = [seed()];
      export fn run(): i32 { return values[0] * 10 + trace; }
    `;
    const result = lowered(source);
    assert.deepEqual(
      checked(source).meta.deferredGlobalInits.map((entry) => [
        entry.kind,
        entry.owner,
        "name" in entry ? entry.name : undefined,
      ]),
      [["array-elements", "values", "values"]],
    );
    assert.notEqual(result.module.start, undefined);
    assert.equal(runExport(result.module, "run"), 41);
  });

  test("splices global struct stores by owner and ordinal", () => {
    const { ast, meta } = checked(`
      struct Pair { left: i32, right: i32 }
      fn one(): i32 { return 1; }
      fn two(): i32 { return 2; }
      let before: i32 = one();
      let pair: Pair = { right = two(), left = one() };
      let after: i32 = two();
    `);
    const result = lowerModule(ast, meta);
    assert.deepEqual(result.pendingInits, []);
    const start = result.module.funcs[result.module.start! - result.module.funcImports.length]!;
    const stores = start.body.filter((statement) => statement.k === "store");
    const pairAddress = Number(
      result.module.globals.find((_, index) => result.module.names.globals.get(index) === "pair")
        ?.init.value,
    );
    const offsets = result.module.structLayouts.get("Pair")!.members.map((member) => member.offset);
    assert.deepEqual(
      stores.map((store) => {
        assert(store.addr.k === "const");
        return Number(store.addr.value) - pairAddress;
      }),
      offsets,
    );
  });

  test("remaps fragment temporaries into start and rejects a kind mismatch", () => {
    const source = `
      struct Box { value: f32 }
      fn left(): f32 { return 7.5; }
      fn right(): f32 { return 2.0; }
      let box: Box = { value = left() % right() };
    `;
    const { ast, meta } = checked(source);
    const memory = meta.deferredGlobalInits[0];
    assert(memory?.kind === "memory");
    const result = lowerModule(ast, meta);
    assert.deepEqual(result.pendingInits, []);
    const start = result.module.funcs[result.module.start! - result.module.funcImports.length]!;
    assert.deepEqual(start.locals, ["f32", "f32"]);
    const store = start.body.find((statement) => statement.k === "store");
    assert(store?.k === "store");
    assert(store.addr.k === "const");
    assert(Number(store.addr.value) >= 65_536);

    const mismatched = checked(source);
    const original = mismatched.meta.deferredGlobalInits[0];
    assert(original?.kind === "memory");
    const { id, owner } = original;
    const box = mismatched.ast.statements.find(
      (statement) =>
        statement instanceof LetStatement && statement.identifier.tokenLiteral() === "box",
    );
    assert(box instanceof LetStatement);
    assert(box.expression instanceof StructLiteralExpression);
    const expression = box.expression.members.value;
    assert(expression);
    mismatched.meta.deferredGlobalInits[0] = {
      kind: "global",
      name: "box",
      type: "i32",
      expr: expression,
      id,
      owner,
    };
    assert.throws(() => lowerModule(mismatched.ast, mismatched.meta), /kind mismatch/);
  });

  test("keeps runtime helpers demand-driven", () => {
    const numeric = lowered(`
      struct Numeric { value: i32 }
      export fn run(): i32 {
        let a: Numeric = { value = 1 };
        let b: Numeric = { value = 1 };
        return a == b;
      }
    `);
    const names = new Set(numeric.module.names.funcs.values());
    assert(names.has("__struct_eq_Numeric"));
    assert(!names.has("__string_eq"));
    assert(!names.has("__elem_addr"));

    const scalar = lowered("export fn run(): i32 { return 1; }");
    assert(!new Set(scalar.module.names.funcs.values()).has("__struct_eq_Numeric"));
    assert(!new Set(scalar.module.names.funcs.values()).has("__string_eq"));
    assert(!new Set(scalar.module.names.funcs.values()).has("__elem_addr"));
  });
});
