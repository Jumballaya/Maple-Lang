import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe } from "node:test";
import { fileURLToPath } from "node:url";
import { compiler } from "../src/compiler/compiler";
import { maybeTest, memoryMinimumFromWat } from "./helpers";

type Project = Record<string, string>;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function instantiate(bytes: Uint8Array): {
  instance: WebAssembly.Instance;
  module: WebAssembly.Module;
} {
  const wasmBytes = new Uint8Array(bytes.byteLength);
  wasmBytes.set(bytes);
  const module = new WebAssembly.Module(wasmBytes);
  const instance = new WebAssembly.Instance(module);
  return { instance, module };
}

async function compileEntry(entry: string): Promise<{
  wat: string;
  instance: WebAssembly.Instance;
  module: WebAssembly.Module;
}> {
  const outputDir = await mkdtemp(path.join(tmpdir(), "maple-entry-"));
  try {
    const output = path.join(outputDir, "app.wasm");
    const parsed = path.parse(entry);
    await compiler(entry, parsed.name, parsed.dir, output);
    const [wat, bytes] = await Promise.all([
      readFile(path.join(outputDir, "app.wat"), "utf8"),
      readFile(output),
    ]);
    return { wat, ...instantiate(bytes) };
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

async function compileProject(files: Project): Promise<{
  wat: string;
  instance: WebAssembly.Instance;
  module: WebAssembly.Module;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "maple-merge-"));
  try {
    for (const [name, source] of Object.entries(files)) {
      const filePath = path.join(dir, name);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, source);
    }
    const entry = path.join(dir, "main.maple");
    const output = path.join(dir, "app.wasm");
    await compiler(entry, "main", dir, output);
    const [wat, bytes] = await Promise.all([
      readFile(path.join(dir, "app.wat"), "utf8"),
      readFile(output),
    ]);
    return { wat, ...instantiate(bytes) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function projectErrors(files: Project): Promise<string[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "maple-errors-"));
  const messages: string[] = [];
  const originalError = console.error;
  try {
    for (const [name, source] of Object.entries(files)) {
      await writeFile(path.join(dir, name), source);
    }
    console.error = (...values: unknown[]) => {
      messages.push(values.map(String).join(" "));
    };
    await compiler(path.join(dir, "main.maple"), "main", dir, path.join(dir, "app.wasm"));
    return messages;
  } finally {
    console.error = originalError;
    await rm(dir, { recursive: true, force: true });
  }
}

function call(instance: WebAssembly.Instance, name: string, ...args: number[]): unknown {
  const fn = instance.exports[name];
  assert.equal(typeof fn, "function", `missing function export ${name}`);
  return (fn as (...values: number[]) => unknown)(...args);
}

function wiredHeapBase(wat: string): number {
  const values = [...wat.matchAll(/\(call \$[^\s()]*heap_init \(i32\.const (\d+)\)\)/g)].map(
    (match) => Number(match[1]),
  );
  const generated = values.find((value) => value !== 131072);
  assert(generated !== undefined, "missing generated heap_init call");
  return generated;
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

  maybeTest("relocates only pointer fields in merged data", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        import dependency from "./dependency.maple"
        let values: i32[] = [65536];
        let labels: string[] = ["kept"];
        let expected: string = "kept";
        export fn run(): i32 {
          return values[0] + (labels[0] == expected) + dependency() - dependency();
        }
      `,
      "dependency.maple": `
        let text: string = "data";
        export fn dependency(): i32 { return text.len; }
      `,
    });

    assert.equal(call(instance, "run"), 65537);
  });

  maybeTest("exports owned memory and only entry-module API names", async () => {
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
      ["memory", "run"],
    );
    assert(!wat.includes('(export "add"'));
  });

  maybeTest("preserves an alloc export when function references need malloc", async () => {
    const { instance, module } = await compileProject({
      "main.maple": `
        fn add(a: i32, b: i32): i32 { return a + b; }
        export fn alloc(): i32 { return 7; }
        export fn run(): i32 {
          let op: fn(i32,i32):i32 = add;
          return op(19, 23);
        }
      `,
    });

    assert.equal(call(instance, "alloc"), 7);
    assert.equal(call(instance, "run"), 42);
    assert(WebAssembly.Module.exports(module).some((entry) => entry.name === "alloc"));
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

  maybeTest("merges malloc and sqrt with module-owned memory", async () => {
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
    assert.deepEqual(WebAssembly.Module.imports(module), []);
    assert(instance.exports.memory instanceof WebAssembly.Memory);
  });

  maybeTest("starts the merged heap above static data without corrupting literals", async () => {
    const { instance, wat } = await compileProject({
      "main.maple": `
        import malloc from "memory"
        struct Cell { value: i32 }
        let label: string = "heap-safe";
        let expected: string = "heap-safe";

        export fn run(): i32 {
          let ptr: i32 = malloc(8);
          let cell: Cell = ptr as Cell;
          cell.value = 37;
          if (cell.value != 37) { return 0; }
          if (label != expected) { return 0; }
          return ptr;
        }
      `,
    });

    const heapBase = wiredHeapBase(wat);
    const pointer = call(instance, "run") as number;
    assert(pointer >= heapBase + 8);
    assert.equal(pointer % 8, 0);
  });

  maybeTest("mixes heap, shadow-stack structs, and string literals", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        import malloc from "memory"
        struct Cell { value: i32 }
        let label: string = "all-regions";
        let expected: string = "all-regions";

        export fn run(): i32 {
          let local: Cell = { value = 5 };
          let ptr: i32 = malloc(8);
          let heap: Cell = ptr as Cell;
          heap.value = 36;
          return local.value + heap.value + (label == expected);
        }
      `,
    });

    assert.equal(call(instance, "run"), 42);
  });

  maybeTest("sizes memory and the heap from more than one page of static data", async () => {
    const literals = Array.from({ length: 72 }, (_, index) => {
      const contents = `${"x".repeat(1016)}-${index.toString().padStart(3, "0")}`;
      return `let static_${index}: string = "${contents}";`;
    }).join("\n");
    const { instance, wat } = await compileProject({
      "main.maple": `
        import malloc from "memory"
        ${literals}
        let expected: string = "${"x".repeat(1016)}-071";

        export fn allocate(): i32 {
          if (static_71 != expected) { return 0; }
          return malloc(8);
        }
        export fn pages(): i32 { return __memory_size(); }
      `,
    });

    const heapBase = wiredHeapBase(wat);
    const minimum = memoryMinimumFromWat(wat);
    assert(heapBase > 2 * 65_536);
    assert.equal(minimum, Math.max(2, Math.ceil(heapBase / 65_536) + 1));
    assert.equal(call(instance, "pages"), minimum);
    assert((call(instance, "allocate") as number) >= heapBase + 8);
  });

  maybeTest("resets the heap when heap_init is called explicitly", async () => {
    const { instance, wat } = await compileProject({
      "main.maple": `
        import malloc, heap_init from "memory"
        export fn run(base: i32): i32 {
          let first: i32 = malloc(8);
          heap_init(base);
          let second: i32 = malloc(8);
          return first == second;
        }
      `,
    });

    assert.equal(call(instance, "run", wiredHeapBase(wat)), 1);
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

describe("Compiler: tree-shaken emission", () => {
  maybeTest("removes unreachable private functions from imported modules", async () => {
    const { instance, wat } = await compileProject({
      "main.maple": `
        import used from "./dep.maple"
        export fn run(): i32 { return used(); }
      `,
      "dep.maple": `
        fn unused(): i32 { return 1; }
        export fn used(): i32 { return 42; }
      `,
    });

    assert.equal(call(instance, "run"), 42);
    assert(wat.includes("(func $dep$$used"));
    assert(!wat.includes("(func $dep$$unused"));
    assert(wat.indexOf("(func $dep$$used") < wat.indexOf("(func $main$$run"));
  });

  maybeTest("removes unreachable exports from non-entry modules", async () => {
    const { wat } = await compileProject({
      "main.maple": `
        import unused from "./dep.maple"
        export fn run(): i32 { return 1; }
      `,
      "dep.maple": "export fn unused(): i32 { return 2; }",
    });

    assert(!wat.includes("(func $dep$$unused"));
  });

  maybeTest("keeps cross-module functions reached only through fn-refs callable", async () => {
    const { instance, module, wat } = await compileProject({
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
    assert(wat.includes("(func $ops$$add"));
    assert(wat.includes("(func $ops$$__indirect_add"));
    assert(wat.includes("(table $__fn_table 1 1 funcref)"));
    assert(wat.includes("(elem (i32.const 0) func $ops$$__indirect_add)"));
    assert(
      WebAssembly.Module.exports(module).every((entry) => !entry.name.includes("__indirect_")),
    );
  });

  maybeTest("does not slot fn-refs created only by unreachable code", async () => {
    const { instance, wat } = await compileProject({
      "main.maple": `
        fn target(value: i32): i32 { return value + 1; }
        fn unused(): i32 {
          let ref: fn(i32):i32 = target;
          return ref(1);
        }
        export fn run(): i32 { return 42; }
      `,
    });

    assert.equal(call(instance, "run"), 42);
    assert(!wat.includes("(func $main$$target"));
    assert(!wat.includes("(func $main$$unused"));
    assert(!wat.includes("(table $__fn_table"));
  });

  maybeTest("keeps functions reached only from startup initialization", async () => {
    const { instance, wat } = await compileProject({
      "main.maple": `
        fn seed(): i32 { return 42; }
        let initialized: i32 = seed();
        export fn run(): i32 { return initialized; }
      `,
    });

    assert.equal(call(instance, "run"), 42);
    assert(wat.includes("(func $main$$seed"));
  });

  maybeTest("emits only the used stdlib function chain", async () => {
    const unused = await compileProject({
      "main.maple": `
        import malloc from "memory"
        import sqrt from "math"
        export fn run(): i32 {
          let block: i32 = malloc(8);
          return block - block;
        }
      `,
    });
    const used = await compileProject({
      "main.maple": `
        import malloc from "memory"
        import sqrt from "math"
        export fn run(): i32 {
          let block: i32 = malloc(8);
          return (sqrt(16.0) as i32) + (block - block);
        }
      `,
    });

    assert.equal(call(unused.instance, "run"), 0);
    assert(!unused.wat.includes("$$sqrt"));
    assert(!unused.wat.includes("$$sin"));
    assert.equal(call(used.instance, "run"), 4);
    assert(used.wat.includes("$$sqrt"));
    assert(!used.wat.includes("$$sin"));
    assert(Buffer.byteLength(used.wat) > Buffer.byteLength(unused.wat));
  });

  maybeTest("type-checks unreachable code before shaking", async () => {
    const errors = await projectErrors({
      "main.maple": `
        fn invalid(): i32 {
          let value: i32 = 1.5;
          return value;
        }
        export fn run(): i32 { return 42; }
      `,
    });

    assert(errors.some((error) => error.includes("cannot assign 'f32' to 'i32'")));
  });

  maybeTest("emits deterministic WAT after filtering", async () => {
    const project = {
      "main.maple": `
        import used from "./dep.maple"
        import unused from "./extra.maple"
        export fn run(): i32 { return used(); }
      `,
      "dep.maple": "export fn used(): i32 { return 42; }",
      "extra.maple": "export fn unused(): i32 { return 0; }",
    };

    const first = await compileProject(project);
    const second = await compileProject(project);

    assert.equal(first.wat, second.wat);
    assert(!first.wat.includes("$$unused"));
  });
});

describe("Compiler: merged-program acceptance", () => {
  maybeTest("uses an imported math struct", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        import fraction from "math"
        export fn run(): i32 {
          let f: fraction = { numerator = 3, denominator = 4 };
          return f.numerator;
        }
      `,
    });

    assert.equal(call(instance, "run"), 3);
  });

  maybeTest("uses an imported user struct across three modules", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        import Pair from "./types.maple"
        import keep_pair from "./consumer.maple"
        export fn run(): i32 {
          let value: Pair = { left = 2, right = 3 };
          let expected: Pair = { left = 7, right = 3 };
          value.left = 7;
          let returned: Pair = keep_pair(value);
          return returned.left + returned.right + (returned == expected);
        }
      `,
      "types.maple": "export struct Pair { left: i32, right: i32 }",
      "consumer.maple": `
        import Pair from "./types.maple"
        export fn keep_pair(value: Pair): Pair { return value; }
      `,
    });

    assert.equal(call(instance, "run"), 11);
  });

  maybeTest("materializes a global literal of an imported struct type", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        import Pair from "./types.maple"
        let origin: Pair = { left = 10, right = 32, label = "pair" };
        let expected: string = "pair";
        export fn run(): i32 { return origin.left + origin.right + (origin.label == expected); }
      `,
      "types.maple": "export struct Pair { left: i32, right: i32, label: string }",
    });

    assert.equal(call(instance, "run"), 43);
  });

  maybeTest("does not wire heap startup to a user stdlib path lookalike", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        import spoof_calls from "./stdlib/memory.maple"
        import malloc from "memory"
        export fn run(): i32 {
          let block: i32 = malloc(8);
          return spoof_calls() + (block - block);
        }
      `,
      "stdlib/memory.maple": `
        let calls: i32 = 0;
        export fn heap_init(data_end: i32): void { calls = calls + 1; }
        export fn spoof_calls(): i32 { return calls; }
      `,
    });

    assert.equal(call(instance, "run"), 0);
  });

  maybeTest("rejects identical layouts with different nominal identities", async () => {
    const errors = await projectErrors({
      "main.maple": `
        import Node from "./a.maple"
        import accept_node from "./b.maple"
        export fn run(): i32 {
          let node: Node = { value = 7 };
          return accept_node(node);
        }
      `,
      "a.maple": "export struct Node { value: i32 }",
      "b.maple": `
        export struct Node { value: i32 }
        export fn accept_node(node: Node): i32 { return node.value; }
      `,
    });

    const message = errors.join("\n");
    assert.match(message, /expected 'b\$\$Node', got 'a\$\$Node'/);
  });

  maybeTest("rejects duplicate imported names across declaration kinds", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "maple-import-collision-"));
    try {
      await writeFile(
        path.join(dir, "main.maple"),
        `
          import item from "./struct.maple"
          import item from "./function.maple"
          export fn run(): i32 { return 0; }
        `,
      );
      await writeFile(path.join(dir, "struct.maple"), "export struct item { value: i32 }");
      await writeFile(path.join(dir, "function.maple"), "export fn item(): i32 { return 1; }");

      await assert.rejects(
        compiler(path.join(dir, "main.maple"), "main", dir, path.join(dir, "app.wasm")),
        /duplicate import (?:id|name).*item/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  maybeTest("compiles and instantiates every demo", async () => {
    const demoRoot = path.join(repoRoot, "demo");
    const directories = (await readdir(demoRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const directory of directories) {
      const entry = path.join(demoRoot, directory, "main.maple");
      const { instance } = await compileEntry(entry);
      assert(instance, `${directory} did not instantiate`);
      if (directory === "01_functions_imports") {
        assert.equal(call(instance, "_start", 2, 3), 10);
      }
    }
  });

  maybeTest("runs the CLI with only npm-provided build tools", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "maple-cli-"));
    try {
      const output = path.join(outputDir, "app.wasm");
      const npm = execFileSync("which", ["npm"], { encoding: "utf8" }).trim();
      const toolFreePath = (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter((directory) => !existsSync(path.join(directory, "wat2wasm")))
        .join(path.delimiter);
      const result = spawnSync(
        npm,
        ["start", "--", "demo/01_functions_imports/main.maple", "-o", output],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: toolFreePath,
          },
        },
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const [bytes, _wat] = await Promise.all([
        readFile(output),
        readFile(path.join(outputDir, "app.wat"), "utf8"),
      ]);
      const { instance } = instantiate(bytes);
      assert.equal(call(instance, "_start", 2, 3), 10);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
