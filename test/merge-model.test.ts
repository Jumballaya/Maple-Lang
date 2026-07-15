import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { buildMergedProgram } from "../src/compiler/emitters/merge-model";
import { buildModuleGraph } from "../src/compiler/module-graph";

function withProgram<T>(files: Record<string, string>, run: (entryPath: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), "maple-merge-model-"));
  try {
    for (const [relativePath, source] of Object.entries(files)) {
      const filePath = path.join(dir, relativePath);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, source);
    }
    return run(path.join(dir, "main.maple"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function modelFor(files: Record<string, string>) {
  return withProgram(files, (entryPath) => buildMergedProgram(buildModuleGraph(entryPath)));
}

describe("Merged program model", () => {
  test("mangles every symbol injectively and exposes only entry exports", () => {
    const model = modelFor({
      "main.maple": `
        import run_dash from "./a-b.maple"
        import run_dot from "./a.b.maple"
        import run_slash from "./a/b.maple"
        export fn run(): i32 { return run_dash() + run_dot() + run_slash(); }
      `,
      "a-b.maple": `let counter: i32 = 1; fn helper(): i32 { return counter; } export fn run_dash(): i32 { return helper(); }`,
      "a.b.maple": `let counter: i32 = 2; fn helper(): i32 { return counter; } export fn run_dot(): i32 { return helper(); }`,
      "a/b.maple": `let counter: i32 = 3; fn helper(): i32 { return counter; } export fn run_slash(): i32 { return helper(); }`,
    });

    const helpers = ["a$2Db$$helper", "a$2Eb$$helper", "a$2Fb$$helper"];
    assert(helpers.every((name) => model.functions.has(name)));
    assert.equal(new Set(helpers).size, 3);
    assert(
      ["a$2Db$$counter", "a$2Eb$$counter", "a$2Fb$$counter"].every((name) =>
        model.globals.has(name),
      ),
    );
    assert.equal(model.exports.get("run"), "main$$run");
    assert.equal(model.exports.has("run_dash"), false);
    assert(model.functions.has("a$2Db$$run_dash"));
  });

  test("keeps struct identity per module while unifying string", () => {
    const model = modelFor({
      "main.maple": `
        import compare_a from "./a.maple"
        import compare_b from "./b.maple"
        import use_node from "./consumer.maple"
        export fn run(): i32 { return 0; }
      `,
      "a.maple": `
        export struct Node { value: i32 }
        export fn compare_a(left: Node, right: Node): bool { return left == right; }
        fn strings_a(left: string, right: string): bool { return left == right; }
      `,
      "b.maple": `
        export struct Node { value: i64 }
        export fn compare_b(left: Node, right: Node): bool { return left == right; }
        fn strings_b(left: string, right: string): bool { return left == right; }
      `,
      "consumer.maple": `
        import Node from "./a.maple"
        export fn use_node(value: Node): i32 { return 1; }
      `,
    });

    assert(model.structs.has("a$$Node"));
    assert(model.structs.has("b$$Node"));
    assert.equal(
      [...model.structs.values()].filter((entry) => entry.sourceName === "string").length,
      1,
    );
    assert(model.runtimeHelpers.has("__struct_eq_a$$Node"));
    assert(model.runtimeHelpers.has("__struct_eq_b$$Node"));
    assert.equal(
      [...model.runtimeHelpers.keys()].filter((name) => name === "__string_eq").length,
      1,
    );
    assert.equal(model.imports.get("consumer$$Node"), "a$$Node");
    assert.equal(model.functions.get("consumer$$use_node")?.resolvedParams[0]?.type, "a$$Node");
  });

  test("rewires user and stdlib imports to mangled direct references", () => {
    withProgram(
      {
        "main.maple": `
          import local_value from "./dep.maple"
          import shared from "./dep.maple"
          import sqrt from "math"
          export fn run(): f32 { return sqrt((local_value() + shared) as f32); }
        `,
        "dep.maple": "export let shared: i32 = 9; export fn local_value(): i32 { return shared; }",
      },
      (entryPath) => {
        const graph = buildModuleGraph(entryPath);
        const model = buildMergedProgram(graph);
        assert.equal(model.imports.get("main$$local_value"), "dep$$local_value");
        assert.equal(model.imports.get("main$$shared"), "dep$$shared");
        const math = [...graph.modules.values()].find((module) =>
          module.filePath.endsWith("/src/compiler/stdlib/math.maple"),
        );
        assert(math);
        assert.equal(model.imports.get("main$$sqrt"), `${math.manglePrefix}$$sqrt`);
        assert.deepEqual(model.externalImports, [{ module: "runtime", name: "memory" }]);
      },
    );
  });

  test("lays out module data contiguously in dependency post-order", () => {
    const model = modelFor({
      "main.maple": `
        import dep_value from "./dep.maple"
        let main_text: string = "main";
        export fn run(): i32 { return dep_value(); }
      `,
      "dep.maple": `
        let dep_text: string = "dependency";
        export fn dep_value(): i32 { return 1; }
      `,
    });

    assert.deepEqual(model.moduleOrder, ["dep", "main"]);
    assert.equal(model.data[0]?.address, 65536);
    for (let index = 1; index < model.data.length; index++) {
      const previous = model.data[index - 1]!;
      assert.equal(model.data[index]?.address, previous.address + previous.size);
    }
    const depEnd = Math.max(
      ...model.data
        .filter((entry) => entry.moduleKey === "dep")
        .map((entry) => entry.address + entry.size),
    );
    const mainStart = Math.min(
      ...model.data.filter((entry) => entry.moduleKey === "main").map((entry) => entry.address),
    );
    assert.equal(depEnd, mainStart);
    assert.equal(model.dataEnd, model.data.at(-1)!.address + model.data.at(-1)!.size);
  });

  test("orders diamond dependencies and startup initializers deterministically", () => {
    const model = modelFor({
      "main.maple": `
        import from_b from "./b.maple"
        import from_c from "./c.maple"
        let first: i32 = from_b();
        let second: i32 = from_c();
        export fn run(): i32 { return first + second; }
      `,
      "b.maple": `
        import from_d from "./d.maple"
        let value_b: i32 = from_d();
        export fn from_b(): i32 { return value_b; }
      `,
      "c.maple": `
        import from_d from "./d.maple"
        let value_c: i32 = from_d();
        export fn from_c(): i32 { return value_c; }
      `,
      "d.maple": `
        fn seed(): i32 { return 1; }
        let value_d: i32 = seed();
        export fn from_d(): i32 { return value_d; }
      `,
    });

    assert.deepEqual(model.moduleOrder, ["d", "b", "c", "main"]);
    assert.deepEqual(
      model.startupInitializers.map((entry) => entry.moduleKey),
      ["d", "b", "c", "main", "main"],
    );
    assert.deepEqual(
      model.startupInitializers.slice(-2).map((entry) => entry.owner),
      ["main$$first", "main$$second"],
    );
  });

  test("deduplicates and deterministically renumbers provisional fn-table entries", () => {
    const model = modelFor({
      "main.maple": `
        fn add(a: i32, b: i32): i32 { return a + b; }
        fn subtract(a: i32, b: i32): i32 { return a - b; }
        export fn run(): i32 {
          let first: fn(i32,i32):i32 = add;
          let again: fn(i32,i32):i32 = add;
          let second: fn(i32,i32):i32 = subtract;
          return first(3, 2) + second(3, 2);
        }
      `,
    });

    assert.equal(model.fnTable.provisional, true);
    assert.equal(model.fnTable.required, true);
    assert.deepEqual(
      model.fnTable.entries.map(({ functionName, slot }) => ({ functionName, slot })),
      [
        { functionName: "main$$add", slot: 0 },
        { functionName: "main$$subtract", slot: 1 },
      ],
    );
    assert.equal(model.fnTable.signatures.size, 1);
  });

  test("records declaration edges and owned data without re-walking later", () => {
    const model = modelFor({
      "main.maple": `
        let total: i32 = 1;
        let items: i32[] = [1, 2, 3];
        fn callee(value: i32): i32 { return value; }
        fn target(value: i32): i32 { return value + 1; }
        fn leaf(): i32 { return 0; }
        export fn root(): i32 {
          total = total + 1;
          let ref: fn(i32):i32 = target;
          let text: string = "owned";
          return callee(ref(items[0])) + total;
        }
      `,
    });

    const root = model.declarations.get("main$$root")!;
    assert.deepEqual(root.edges.calls, ["main$$callee"]);
    assert.deepEqual(root.edges.fnRefs, ["main$$target"]);
    assert.deepEqual(root.edges.globalReads, ["main$$total", "main$$items"]);
    assert.deepEqual(root.edges.globalWrites, ["main$$total"]);
    assert.deepEqual(root.edges.runtimeHelpers, ["__make_fnref", "__elem_addr"]);
    assert.equal(root.edges.ownedData.length, 1);
    assert.equal(model.dataAllocations.get(root.edges.ownedData[0]!)?.owner, "main$$root");

    const leaf = model.declarations.get("main$$leaf")!;
    assert.deepEqual(leaf.edges, {
      calls: [],
      fnRefs: [],
      globalReads: [],
      globalWrites: [],
      runtimeHelpers: [],
      ownedData: [],
    });
  });

  test("is deeply deterministic", () => {
    withProgram(
      {
        "main.maple": `
          import value from "./dep.maple"
          export fn run(): i32 { return value(); }
        `,
        "dep.maple": 'let text: string = "same"; export fn value(): i32 { return 1; }',
      },
      (entryPath) => {
        assert.deepEqual(
          buildMergedProgram(buildModuleGraph(entryPath)),
          buildMergedProgram(buildModuleGraph(entryPath)),
        );
      },
    );
  });
});
