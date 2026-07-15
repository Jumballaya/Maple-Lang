import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe } from "node:test";
import { compiler } from "../src/compiler/compiler";
import { maybeTest } from "./helpers";

type Project = Record<string, string>;

async function compileProject(files: Project): Promise<{
  wat: string;
  instance: WebAssembly.Instance;
  module: WebAssembly.Module;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "maple-merge-"));
  try {
    for (const [name, source] of Object.entries(files)) {
      await writeFile(path.join(dir, name), source);
    }
    const entry = path.join(dir, "main.maple");
    const output = path.join(dir, "app.wasm");
    await compiler(entry, "main", dir, output);
    const [wat, bytes] = await Promise.all([
      readFile(path.join(dir, "app.wat"), "utf8"),
      readFile(output),
    ]);
    const memory = new WebAssembly.Memory({ initial: 4 });
    const wasmBytes = new Uint8Array(bytes.byteLength);
    wasmBytes.set(bytes);
    const module = new WebAssembly.Module(wasmBytes);
    const instance = new WebAssembly.Instance(module, { runtime: { memory } });
    return { wat, instance, module };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function call(instance: WebAssembly.Instance, name: string, ...args: number[]): unknown {
  const fn = instance.exports[name];
  assert.equal(typeof fn, "function", `missing function export ${name}`);
  return (fn as (...values: number[]) => unknown)(...args);
}

describe("Compiler: merged whole-program emission", () => {
  maybeTest("runs a two-module program as one wasm module", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        import add from "./math.maple"
        export fn run(): i32 { return add(20, 22); }
      `,
      "math.maple": "export fn add(a: i32, b: i32): i32 { return a + b; }",
    });

    assert.equal(call(instance, "run"), 42);
  });

  maybeTest("emits a diamond dependency once", async () => {
    const { instance, wat } = await compileProject({
      "main.maple": `
        import from_b from "./b.maple"
        import from_c from "./c.maple"
        export fn run(): i32 { return from_b() + from_c(); }
      `,
      "b.maple": `
        import base from "./d.maple"
        export fn from_b(): i32 { return base() + 1; }
      `,
      "c.maple": `
        import base from "./d.maple"
        export fn from_c(): i32 { return base() + 2; }
      `,
      "d.maple": "export fn base(): i32 { return 10; }",
    });

    assert.equal(call(instance, "run"), 23);
    assert.equal(wat.match(/\(func \$d\$\$base\b/g)?.length, 1);
  });

  maybeTest("isolates private collisions and identical string literals", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        import from_a from "./a.maple"
        import from_b from "./b.maple"
        export fn run(): i32 { return from_a() + from_b(); }
      `,
      "a.maple": `
        let private_value: i32 = 10;
        let label: string = "same";
        let expected: string = "same";
        fn helper(): i32 { return private_value; }
        export fn from_a(): i32 { return helper() + (label == expected); }
      `,
      "b.maple": `
        let private_value: i32 = 20;
        let label: string = "same";
        let expected: string = "same";
        fn helper(): i32 { return private_value; }
        export fn from_b(): i32 { return helper() + (label == expected); }
      `,
    });

    assert.equal(call(instance, "run"), 32);
  });

  maybeTest("relocates distinct data from multiple modules", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        import first from "./first.maple"
        import second from "./second.maple"
        export fn run(): i32 { return first() + second(); }
      `,
      "first.maple": `
        let value: string = "alpha";
        let expected: string = "alpha";
        export fn first(): i32 { return value == expected; }
      `,
      "second.maple": `
        let value: string = "beta-longer";
        let expected: string = "beta-longer";
        export fn second(): i32 { return value == expected; }
      `,
    });

    assert.equal(call(instance, "run"), 2);
  });

  maybeTest("exports only entry-module API names", async () => {
    const { instance, module, wat } = await compileProject({
      "main.maple": `
        import add from "./math.maple"
        export fn run(): i32 { return add(2, 3); }
      `,
      "math.maple": "export fn add(a: i32, b: i32): i32 { return a + b; }",
    });

    assert.equal(call(instance, "run"), 5);
    assert.deepEqual(
      WebAssembly.Module.exports(module).map((entry) => entry.name),
      ["run"],
    );
    assert(!wat.includes('(export "add"'));
  });

  maybeTest("keeps same-named struct equality helpers module-local", async () => {
    const { instance, wat } = await compileProject({
      "main.maple": `
        import eq_a from "./a.maple"
        import eq_b from "./b.maple"
        export fn run(): i32 { return eq_a() + eq_b(); }
      `,
      "a.maple": `
        struct Node { value: i32 }
        export fn eq_a(): i32 {
          let left: Node = { value = 7 };
          let right: Node = { value = 7 };
          return left == right;
        }
      `,
      "b.maple": `
        struct Node { flag: bool, weight: f32 }
        export fn eq_b(): i32 {
          let left: Node = { flag = true, weight = 2.5 };
          let right: Node = { flag = true, weight = 2.5 };
          return left == right;
        }
      `,
    });

    assert.equal(call(instance, "run"), 2);
    assert(wat.includes("__struct_eq_a$$Node"));
    assert(wat.includes("__struct_eq_b$$Node"));
  });

  maybeTest("takes a function reference from another merged module", async () => {
    const { instance, wat } = await compileProject({
      "main.maple": `
        import add from "./ops.maple"
        export fn run(): i32 {
          let op: fn(i32,i32):i32 = add;
          return op(19, 23);
        }
      `,
      "ops.maple": "export fn add(a: i32, b: i32): i32 { return a + b; }",
    });

    assert.equal(call(instance, "run"), 42);
    assert.equal(wat.match(/\(table \$__fn_table/g)?.length, 1);
  });

  maybeTest("merges malloc and sqrt with only runtime memory imported", async () => {
    const { instance, module } = await compileProject({
      "main.maple": `
        import malloc from "memory"
        import sqrt from "math"
        export fn run(): i32 {
          let block: i32 = malloc(16);
          return (sqrt(16.0) as i32) + (block - block);
        }
      `,
    });

    assert.equal(call(instance, "run"), 4);
    assert.deepEqual(WebAssembly.Module.imports(module), [
      { module: "runtime", name: "memory", kind: "memory" },
    ]);
  });

  maybeTest("runs deferred global initializers in dependency post-order", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        import base from "./dependency.maple"
        let answer: i32 = base + 1;
        export fn run(): i32 { return answer; }
      `,
      "dependency.maple": `
        fn seed(): i32 { return 41; }
        export let base: i32 = seed();
      `,
    });

    assert.equal(call(instance, "run"), 42);
  });

  maybeTest("emits byte-identical WAT for identical projects", async () => {
    const project = {
      "main.maple": `
        import value from "./value.maple"
        export fn run(): i32 { return value(); }
      `,
      "value.maple": "export fn value(): i32 { return 42; }",
    };
    const first = await compileProject(project);
    const second = await compileProject(project);

    assert.equal(first.wat, second.wat);
  });

  maybeTest("does not require a linker executable on PATH", async () => {
    const wat2wasm = execFileSync("which", ["wat2wasm"], { encoding: "utf8" }).trim();
    const node = execFileSync("which", ["node"], { encoding: "utf8" }).trim();
    const originalPath = process.env.PATH;
    process.env.PATH = [path.dirname(wat2wasm), path.dirname(node)].join(path.delimiter);
    try {
      const { instance } = await compileProject({
        "main.maple": "export fn run(): i32 { return 42; }",
      });
      assert.equal(call(instance, "run"), 42);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
