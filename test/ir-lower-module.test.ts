import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { buildMergedLoweringInput } from "../src/compiler/merge";
import { buildMergedProgram } from "../src/compiler/merge-model";
import type { ModuleMeta } from "../src/compiler/metadata";
import { buildModuleGraph } from "../src/compiler/module-graph";
import { collectFnReferences, extractModuleMeta } from "../src/compiler/module-metadata";
import { typeCheck } from "../src/compiler/TypeChecker";
import { encodeWasm } from "../src/ir/encode-wasm";
import type { IrModule } from "../src/ir/ir";
import { type LoweringOptions, lowerModule } from "../src/ir/lower";
import { printWat } from "../src/ir/print-wat";
import type { ASTProgram } from "../src/parser/ast/ASTProgram";
import { Parser } from "../src/parser/Parser";

type CheckedProgram = { ast: ASTProgram; meta: ModuleMeta };

function checked(source: string): CheckedProgram {
  const parser = new Parser(source, "module.maple");
  const ast = parser.parse("module");
  assert.deepEqual(
    parser.errors.map((error) => error.message),
    [],
  );
  const meta = extractModuleMeta(ast, true);
  collectFnReferences(ast, meta);
  assert.deepEqual(
    typeCheck(ast, meta).map((error) => error.message),
    [],
  );
  return { ast, meta };
}

function lowered(source: string, options: Partial<LoweringOptions> = {}) {
  const { ast, meta } = checked(source);
  const result = lowerModule(ast, meta, { importMemory: false, ...options });
  return {
    ...result,
    wat: printWat(result.module),
  };
}

function mergedLowered(files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), "maple-ir-merged-"));
  try {
    for (const [name, source] of Object.entries(files)) {
      const filePath = join(directory, name);
      mkdirSync(join(filePath, ".."), { recursive: true });
      writeFileSync(filePath, source);
    }
    const graph = buildModuleGraph(join(directory, "main.maple"));
    for (const module of graph.modules.values()) {
      for (const imported of Object.values(module.data.imports)) {
        if (imported.resolved) continue;
        const dependency = module.dependencies.find(
          (entry) => entry.specifier === imported.module && entry.kind === "maple",
        );
        const exporter = dependency?.key ? graph.modules.get(dependency.key) : undefined;
        const exported = exporter?.data.exports[imported.name];
        assert(exporter && exported);
        imported.info = exported;
        imported.resolved = true;
        imported.mergeable = true;
        if (exported.kind === "func") {
          const target = exporter.data.functions[imported.name];
          assert(target);
          imported.mapleParams = target.params.map((parameter) => parameter.type);
          imported.mapleResults = [...target.mapleResults];
        } else if (exported.kind === "global") {
          imported.mapleType = exported.type;
        }
      }
    }
    for (const module of graph.modules.values()) {
      assert.deepEqual(
        typeCheck(module.ast, module.data).map((error) => error.message),
        [],
      );
    }
    const model = buildMergedProgram(graph);
    const input = buildMergedLoweringInput(model);
    const result = lowerModule(input.ast, input.meta, {
      importMemory: false,
      exportMap: input.exportMap,
      ...(input.allocator === undefined ? {} : { allocator: input.allocator }),
    });
    return { model, input, ...result, wat: printWat(result.module) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function instantiate(module: IrModule, imports: WebAssembly.Imports = {}): WebAssembly.Instance {
  const bytes = encodeWasm(module) as Uint8Array<ArrayBuffer>;
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), imports);
}

function allocatorImports(): WebAssembly.Imports {
  let cursor = 100_000;
  return {
    memory: {
      malloc(size: number): number {
        const result = cursor;
        cursor += size;
        return result;
      },
    },
  };
}

function call(instance: WebAssembly.Instance, name: string, args: number[] = []): unknown {
  const fn = instance.exports[name];
  assert.equal(typeof fn, "function");
  return (fn as (...values: number[]) => unknown)(...args);
}

describe("IR module lowering: function references", () => {
  test("executes local, parameter, void, discarded, and multi-result indirect calls", () => {
    const { wat, module, pendingInits } = lowered(`
      let trace: i32 = 0;
      fn add(value: i32): i32 { return value + 1; }
      fn mark(value: i32): void { trace += value; }
      fn pair(value: i32): (i32, i32) { return value, value + 10; }
      fn apply(op: fn(i32):i32, value: i32): i32 { return op(value); }
      fn pass(op: fn(i32):(i32,i32), value: i32): (i32, i32) { return op(value); }
      export fn run(): i32 {
        let unary: fn(i32):i32 = add;
        let effect: fn(i32):void = mark;
        let many: fn(i32):(i32,i32) = pair;
        effect(3);
        unary(9);
        let (a, b) = many(4);
        many(99);
        let (c, d) = pass(many, 5);
        return apply(unary, 6) * 10000 + trace * 1000 + a * 100 + b * 10 + c + d;
      }
    `);
    assert.equal(module.table?.entries.length, 3);
    assert.deepEqual(pendingInits, []);
    assert.match(wat, /call_indirect/);
    assert.equal(call(instantiate(module, allocatorImports()), "run"), 73_560);
  });

  test("stores and invokes a function reference through a struct field", () => {
    const { module } = lowered(`
      struct Holder { callback: fn(i32):i32 }
      fn double(value: i32): i32 { return value * 2; }
      export fn run(): i32 {
        let holder: Holder = { callback = double };
        return holder.callback(21);
      }
    `);
    assert.equal(call(instantiate(module, allocatorImports()), "run"), 42);
  });

  test("emits a zero-slot table without an allocator for a fn-typed surface", () => {
    const { module, wat } = lowered(`
      export fn apply(op: fn(i32):i32, value: i32): i32 { return op(value); }
    `);
    assert.deepEqual(module.table?.entries, []);
    assert.match(wat, /\(table \$__fn_table 0 0 funcref\)/);
    assert.doesNotMatch(wat, /__make_fnref|malloc/);
    instantiate(module);
  });

  test("requires the exact allocator handoff only for creation sites", () => {
    const { ast, meta } = checked(`
      fn target(value: i32): i32 { return value; }
      export fn run(): i32 { let ref: fn(i32):i32 = target; return ref(1); }
    `);
    delete meta.imports.alloc;
    assert.throws(
      () => lowerModule(ast, meta),
      /function references require the merged memory allocator/,
    );
  });
});

describe("IR module lowering: start and assembly", () => {
  test("runs scalar and memory initializers at instantiation and consumes fragments", () => {
    const { module, pendingInits } = lowered(`
      struct Pair { left: i32, rem: f32 }
      fn base(): i32 { return 7; }
      fn left(): f32 { return 7.5; }
      fn right(): f32 { return 2.0; }
      let A: i32 = base();
      export const B: i32 = A + 5;
      let pair: Pair = { left = A, rem = left() % right() };
      export fn read(): i32 { return pair.left + (pair.rem as i32); }
    `);
    assert.notEqual(module.start, undefined);
    assert.deepEqual(pendingInits, []);
    const instance = instantiate(module);
    assert.equal((instance.exports.B as WebAssembly.Global).value, 12);
    assert.equal(call(instance, "read"), 8);
  });

  test("remaps distinct array and float fragment locals without collisions", () => {
    const { ast, meta } = checked(`
      struct Pair { item: i32, rem: f32 }
      fn index(): i32 { return 0; }
      fn left(): f32 { return 7.5; }
      fn right(): f32 { return 2.0; }
      let pair: Pair = { item = [7][index()], rem = left() % right() };
      export fn read(): i32 { return pair.item + (pair.rem as i32); }
    `);
    const { module } = lowerModule(ast, meta);
    const start = module.funcs[module.start! - module.funcImports.length]!;
    assert.deepEqual(start.locals, ["i32", "i32", "f32", "f32"]);
    assert.equal(call(instantiate(module), "read"), 8);
  });

  test("omits start when no deferred initializer exists", () => {
    const { module, wat } = lowered("export fn run(): i32 { return 1; }");
    assert.equal(module.start, undefined);
    assert.doesNotMatch(wat, /\(start /);
  });

  test("traps during instantiation when a deferred initializer traps", () => {
    const { ast, meta } = checked(`
      struct Box { value: i32 }
      let box: Box = { value = [1][2] };
      export fn run(): i32 { return box.value; }
    `);
    assert.throws(() => instantiate(lowerModule(ast, meta).module), WebAssembly.RuntimeError);
  });

  test("supports public export mapping and both memory modes deterministically", () => {
    const source = `
      export let value: i32 = 9;
      export fn run(): i32 { return value; }
    `;
    const first = lowered(source, {
      exportMap: new Map([
        ["answer", "run"],
        ["state", "value"],
      ]),
    });
    const second = lowered(source, {
      exportMap: new Map([
        ["answer", "run"],
        ["state", "value"],
      ]),
    });
    assert.equal(first.wat, second.wat);
    const bytes = encodeWasm(first.module);
    assert.deepEqual(bytes, encodeWasm(second.module));
    const ownedBytes = new Uint8Array(bytes.byteLength);
    ownedBytes.set(bytes);
    assert.deepEqual(WebAssembly.Module.exports(new WebAssembly.Module(ownedBytes)), [
      { name: "memory", kind: "memory" },
      { name: "state", kind: "global" },
      { name: "answer", kind: "function" },
    ]);

    const imported = lowered(source, { importMemory: true });
    const memory = new WebAssembly.Memory({ initial: imported.module.memory.initialPages });
    assert.equal(call(instantiate(imported.module, { runtime: { memory } }), "run"), 9);
  });
});

describe("IR module lowering: imports", () => {
  test("lowers resolved external function and global imports to IR ids", () => {
    const parser = new Parser(`
      import host_add from "host"
      import seed from "host"
      export fn run(value: i32): i32 { return host_add(value) + seed; }
    `);
    const ast = parser.parse("imports");
    assert.deepEqual(parser.errors, []);
    const meta = extractModuleMeta(ast, true);
    meta.imports.host_add = {
      module: "host",
      name: "host_add",
      resolved: true,
      mergeable: false,
      info: { kind: "func", signature: "i_i" },
      mapleParams: ["i32"],
      mapleResults: ["i32"],
    };
    meta.imports.seed = {
      module: "host",
      name: "seed",
      resolved: true,
      mergeable: false,
      info: { kind: "global", type: "i32" },
      mapleType: "i32",
    };
    collectFnReferences(ast, meta);
    assert.deepEqual(typeCheck(ast, meta), []);
    const result = lowerModule(ast, meta);
    const instance = instantiate(result.module, {
      host: { host_add: (value: number) => value + 2, seed: 5 },
    });
    assert.equal(call(instance, "run", [10]), 17);
  });
});

describe("IR module lowering: merged bridge and reachability", () => {
  test("keeps unreachable fn surfaces and creation sites out of the assembled module", () => {
    const surface = mergedLowered({
      "main.maple": `
        fn unused(op: fn(i32):i32, value: i32): i32 { return op(value); }
        export fn run(): i32 { return 42; }
      `,
    });
    assert.equal(surface.model.fnTable.hasFnTypedSurface, false);
    assert.equal(surface.module.table, undefined);

    const creation = mergedLowered({
      "main.maple": `
        fn target(value: i32): i32 { return value + 1; }
        fn unused(): i32 {
          let ref: fn(i32):i32 = target;
          return ref(1);
        }
        export fn run(): i32 { return 42; }
      `,
    });
    assert.equal(creation.model.fnTable.needsFnrefCreation, false);
    assert.equal(creation.input.allocator, undefined);
    assert.equal(creation.model.reachable.functions.has("main$$target"), false);
    assert.equal(
      [...creation.model.reachable.functions].some((name) => name.endsWith("$$malloc")),
      false,
    );
    assert.equal(
      creation.model.startupInitializers.some((entry) => entry.id.endsWith("heap-init")),
      false,
    );
    assert.doesNotMatch(creation.wat, /__make_fnref|malloc|heap_init|\(table /);
    assert.equal(call(instantiate(creation.module), "run"), 42);
  });

  test("preserves a zero-slot table through the merged bridge without memory", () => {
    const result = mergedLowered({
      "main.maple": `
        export fn apply(op: fn(i32):i32, value: i32): i32 { return op(value); }
      `,
    });
    assert.equal(result.model.fnTable.hasFnTypedSurface, true);
    assert.equal(result.model.fnTable.needsFnrefCreation, false);
    assert.deepEqual(result.module.table?.entries, []);
    assert.equal(
      [...result.model.modules.values()].some((module) => module.bundledStdlib === "memory"),
      false,
    );
    assert.doesNotMatch(result.wat, /__make_fnref|malloc|heap_init/);
    instantiate(result.module);
  });

  test("runs cross-module fnrefs with the resolved allocator and rebaked heap start", () => {
    const result = mergedLowered({
      "main.maple": `
        import add from "./ops.maple"
        import malloc from "memory"
        export fn run(): i32 {
          let op: fn(i32,i32):i32 = add;
          let text: string = "payload";
          return op(19, 16) + text.len;
        }
        export fn allocate(): i32 { return malloc(8); }
      `,
      "ops.maple": "export fn add(a: i32, b: i32): i32 { return a + b; }",
    });
    assert.equal(result.model.fnTable.needsFnrefCreation, true);
    assert.notEqual(result.input.allocator, undefined);
    assert(result.model.startupInitializers[0]?.id.endsWith("heap-init"));
    const startIndex = result.module.start! - result.module.funcImports.length;
    const first = result.module.funcs[startIndex]?.body[0];
    assert(first?.k === "call");
    assert(first.args[0]?.k === "const");
    assert.equal(first.args[0].value, Math.ceil(result.module.dataEnd / 8) * 8);
    const instance = instantiate(result.module);
    assert.equal(call(instance, "run"), 42);
    assert(Number(call(instance, "allocate")) >= Math.ceil(result.module.dataEnd / 8) * 8);
  });

  test("executes dependency startup before importer startup at instantiation", () => {
    const result = mergedLowered({
      "main.maple": `
        import base from "./dep.maple"
        export const answer: i32 = base + 1;
      `,
      "dep.maple": `
        fn seed(): i32 { return 41; }
        export let base: i32 = seed();
      `,
    });
    assert.deepEqual(
      result.input.meta.deferredGlobalInits.map((entry) => entry.owner),
      ["dep$$base", "main$$answer"],
    );
    const instance = instantiate(result.module);
    assert.equal((instance.exports.answer as WebAssembly.Global).value, 42);
  });

  test("interleaves heap, dependency scalar, memory, array, and importer startup", () => {
    const result = mergedLowered({
      "main.maple": `
        import value from "./dep.maple"
        import malloc from "memory"
        export let answer: i32 = value() + 4;
        export fn allocate(): i32 { return malloc(8); }
      `,
      "dep.maple": `
        struct State { value: i32 }
        fn seed_value(): i32 { return 2; }
        let seed: i32 = seed_value();
        let state: State = { value = seed + 3 };
        let values: i32[] = [state.value];
        export fn value(): i32 { return values[0]; }
      `,
    });
    assert(result.input.meta.deferredGlobalInits[0]?.owner?.endsWith("$$heap_init"));
    assert.deepEqual(
      result.input.meta.deferredGlobalInits.map((entry) => [entry.kind, entry.owner]),
      [
        ["call", result.input.meta.deferredGlobalInits[0]?.owner],
        ["global", "dep$$seed"],
        ["memory", "dep$$state"],
        ["array-elements", "dep$$values"],
        ["global", "main$$answer"],
      ],
    );
    const arrayInitializer = result.input.meta.deferredGlobalInits[3];
    assert(arrayInitializer?.kind === "array-elements");
    assert.equal(arrayInitializer.name, "dep$$values");
    const instance = instantiate(result.module);
    assert.equal((instance.exports.answer as WebAssembly.Global).value, 9);
  });

  test("roots a dependency global touched only by dynamic-array startup", () => {
    const result = mergedLowered({
      "main.maple": `
        import ready from "./dep.maple"
        export fn run(): i32 { return ready(); }
      `,
      "dep.maple": `
        fn seed(): i32 { return 7; }
        let startup_only: i32[] = [seed()];
        export fn ready(): i32 { return 1; }
      `,
    });
    assert(result.model.reachable.globals.has("dep$$startup_only"));
    assert(result.model.reachable.functions.has("dep$$seed"));
    assert.equal(call(instantiate(result.module), "run"), 1);
  });
});
