import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { linkStdlibImports } from "../src/compiler/compiler";
import type { ModuleMeta } from "../src/compiler/emitters/emitter.types";
import {
  collectFnReferences,
  emitModule,
  extractModuleMeta,
} from "../src/compiler/emitters/module";
import { typeCheck } from "../src/compiler/TypeChecker";
import { structLayout } from "../src/ir/layout";
import { lowerModule } from "../src/ir/lower";
import { printWat } from "../src/ir/print-wat";
import { validateModule } from "../src/ir/validate";
import type { ASTProgram } from "../src/parser/ast/ASTProgram";
import { StructStatement } from "../src/parser/ast/statements/StructStatement";
import { Parser } from "../src/parser/Parser";
import { maybeTest, runExport } from "./helpers";

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

function lowered(source: string): ReturnType<typeof lowerModule> & { oldWat: string; wat: string } {
  const { ast, meta } = checked(source);
  const result = lowerModule(ast, meta, { importMemory: false });
  assert.deepEqual(validateModule(result.module), []);
  return {
    ...result,
    oldWat: emitModule(ast, meta, { importMemory: false }).buildWat(),
    wat: printWat(result.module),
  };
}

function differential(source: string, exportName: string, args: (number | bigint)[] = []): unknown {
  const { oldWat, wat } = lowered(source);
  const expected = runExport(oldWat, exportName, args);
  const actual = runExport(wat, exportName, args);
  assert.deepEqual(actual, expected);
  return actual;
}

function fixed(source: string, exportName: string, args: (number | bigint)[] = []): unknown {
  const { ast, meta } = checked(source);
  const result = lowerModule(ast, meta, { importMemory: false });
  assert.deepEqual(validateModule(result.module), []);
  return runExport(printWat(result.module), exportName, args);
}

describe("IR memory lowering: layout and frames", () => {
  test("matches parser alignment for mixed-width structs", () => {
    const { ast } = checked(`
      struct Mixed { byte: i8, wide: i64, half: i16, tail: u8 }
      struct Reverse { half: i16, byte: u8, wide: u64 }
      fn unused(): void {}
    `);
    for (const statement of ast.statements) {
      if (!(statement instanceof StructStatement)) continue;
      const layout = structLayout(statement.members);
      assert.equal(layout.size, statement.size);
      assert.deepEqual(
        layout.members.map(({ name, offset }) => ({ name, offset })),
        Object.values(statement.members).map(({ name, offset }) => ({ name, offset })),
      );
    }
  });

  maybeTest("isolates recursive frames and restores on early return", () => {
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
  maybeTest("preserves shared local literal buffers across calls", () => {
    const source = `
      fn touch(): i32 {
        let values: i32[] = [1];
        let old: i32 = values[0];
        values[0] = old + 1;
        return old;
      }
      export fn run(): i32 { return touch() * 10 + touch(); }
    `;
    assert.equal(differential(source, "run"), 12);
  });

  maybeTest("traps negative, length, and huge indices", () => {
    const { oldWat, wat } = lowered(`
      export fn read(i: i32): i32 { let values: i32[] = [4, 5]; return values[i]; }
    `);
    assert.equal(runExport(wat, "read", [1]), 5);
    for (const index of [-1, 2, 2_000_000_000]) {
      assert.throws(() => runExport(oldWat, "read", [index]), WebAssembly.RuntimeError);
      assert.throws(() => runExport(wat, "read", [index]), WebAssembly.RuntimeError);
    }
  });

  maybeTest("round-trips every scalar element lane and sub-word width", () => {
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

  maybeTest("lowers arbitrary bases and every index mutation once", () => {
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

  maybeTest("captures an indexed address before evaluating the rhs", () => {
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

  maybeTest("handles inline, returned, member, and call-result array bases", () => {
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
  maybeTest("does not intern literals and compares their contents", () => {
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

  maybeTest("allocates literals in returns, nested calls, and infix expressions", () => {
    const source = `
      fn text(): string { return "hello"; }
      fn same(value: string): i32 { return value == "hello"; }
      export fn run(): i32 { return same(text()) * 10 + same("hello"); }
    `;
    assert.equal(fixed(source, "run"), 11);
  });

  maybeTest("reads string arrays and delegates element equality", () => {
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
  maybeTest("copies struct pointers on assignment", () => {
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

  maybeTest("evaluates literal fields in declaration order", () => {
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

  maybeTest("supports array and string fields plus member mutations", () => {
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

  maybeTest("reads call-result members and mutates through a parameter alias", () => {
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

  maybeTest("keeps plain indexed postfix differential", () => {
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

  maybeTest("closes nested equality over string-bearing members", () => {
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
    assert.equal(runExport(result.wat, "run"), 1);
    const helperNames = new Set(result.module.names.funcs.values());
    assert(helperNames.has("__struct_eq_Outer"));
    assert(helperNames.has("__struct_eq_Inner"));
    assert(helperNames.has("__string_eq"));
  });

  maybeTest("reads and writes all i32-backed field kinds", () => {
    const source = `
      struct Holder { callback: fn(i32): i32, value: i32 }
      export fn run(callback: fn(i32): i32): i32 {
        let holder: Holder = { callback = callback, value = 0 };
        let read: fn(i32): i32 = holder.callback;
        return read == callback;
      }
    `;
    const result = lowered(source);
    assert.equal(runExport(result.wat, "run", [123]), 1);
  });

  maybeTest("encodes aggregate fields of global structs directly", () => {
    const source = `
      struct Global { values: i32[], name: string }
      let global: Global = { values = [8, 9], name = "g" };
      export fn run(): i32 { return global.values[1] * 10 + global.name.len; }
    `;
    assert.equal(fixed(source, "run"), 91);
  });
});

describe("IR memory lowering: startup initializers and helper demand", () => {
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
    memory.baseAddr = 7;
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
    assert.notEqual(id, undefined);
    assert.notEqual(owner, undefined);
    mismatched.meta.deferredGlobalInits[0] = {
      kind: "global",
      name: "box",
      type: "i32",
      expr: original.expr,
      id: id!,
      owner: owner!,
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
