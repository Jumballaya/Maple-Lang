import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { compiler } from "../src/compiler/compiler";

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
  bytes: Uint8Array;
  instance: WebAssembly.Instance;
  module: WebAssembly.Module;
}> {
  const outputDir = await mkdtemp(path.join(tmpdir(), "maple-entry-"));
  try {
    const output = path.join(outputDir, "app.wasm");
    const watPath = path.join(outputDir, "app.wat");
    const parsed = path.parse(entry);
    await compiler(entry, parsed.name, parsed.dir, output, {
      importMemory: false,
      emitWat: watPath,
    });
    const [wat, bytes] = await Promise.all([readFile(watPath, "utf8"), readFile(output)]);
    return { wat, bytes, ...instantiate(bytes) };
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

async function compileProject(files: Project): Promise<{
  wat: string;
  bytes: Uint8Array;
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
    const watPath = path.join(dir, "app.wat");
    await compiler(entry, "main", dir, output, {
      importMemory: false,
      emitWat: watPath,
    });
    const [wat, bytes] = await Promise.all([readFile(watPath, "utf8"), readFile(output)]);
    return { wat, bytes, ...instantiate(bytes) };
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

describe("Compiler: direct artifact options", () => {
  test("writes each requested artifact, creates parents, and strips only wasm", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "maple-artifacts-"));
    try {
      const entry = path.join(dir, "main.maple");
      await writeFile(entry, "export fn run(): i64 { return 42; }");

      const watOnlyWasm = path.join(dir, "wat-only.wasm");
      const watOnly = path.join(dir, "wat-only.wat");
      await compiler(entry, "main", dir, watOnlyWasm, {
        importMemory: false,
        emitWat: watOnly,
      });
      assert.match(await readFile(watOnly, "utf8"), /\(module/);

      const irOnlyWasm = path.join(dir, "ir-only.wasm");
      const irOnly = path.join(dir, "ir-only.json");
      await compiler(entry, "main", dir, irOnlyWasm, {
        importMemory: false,
        emitIr: irOnly,
      });
      assert.match(await readFile(irOnly, "utf8"), /"\$bigint": "42"/);

      const nested = path.join(dir, "nested", "artifacts");
      const fullWasm = path.join(nested, "full", "app.wasm");
      const fullWat = path.join(nested, "wat", "app.wat");
      const fullIr = path.join(nested, "ir", "app.json");
      await compiler(entry, "main", dir, fullWasm, {
        importMemory: false,
        emitWat: fullWat,
        emitIr: fullIr,
      });

      const strippedWasm = path.join(dir, "stripped.wasm");
      await compiler(entry, "main", dir, strippedWasm, {
        importMemory: false,
        strip: true,
      });

      const [fullBytes, strippedBytes] = await Promise.all([
        readFile(fullWasm),
        readFile(strippedWasm),
      ]);
      assert(fullBytes.length > strippedBytes.length);
      assert.deepEqual(fullBytes.subarray(0, strippedBytes.length), strippedBytes);
      assert(instantiate(fullBytes));
      assert(instantiate(strippedBytes));
      assert.match(await readFile(fullWat, "utf8"), /\(module/);
      assert.match(await readFile(fullIr, "utf8"), /"\$bigint": "42"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects every resolved output-path collision", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "maple-artifact-collisions-"));
    try {
      const entry = path.join(dir, "main.maple");
      const output = path.join(dir, "app.wasm");
      await writeFile(entry, "export fn run(): i32 { return 42; }");

      await assert.rejects(
        compiler(entry, "main", dir, output, {
          importMemory: false,
          emitWat: path.join(dir, ".", "app.wasm"),
        }),
        /--emit-wat path collides with the output path/,
      );
      await assert.rejects(
        compiler(entry, "main", dir, output, {
          importMemory: false,
          emitIr: path.join(dir, "nested", "..", "app.wasm"),
        }),
        /--emit-ir path collides with the output path/,
      );
      await assert.rejects(
        compiler(entry, "main", dir, output, {
          importMemory: false,
          emitWat: path.join(dir, "debug", "module.txt"),
          emitIr: path.join(dir, "debug", ".", "module.txt"),
        }),
        /--emit-ir path collides with --emit-wat/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/*
 * WAT assertions were inventoried and behavioralized by T33–T36/T38; the
 * conversion maps live in git history. Runtime semantics stay in execution
 * tests; only host-surface and intentionally
 * unobservable reachability facts survive here. Regexes tolerate whitespace
 * and generated-name prefixes and never require cross-section ordering.
 */
describe("host surface (WAT-structural)", () => {
  function wiredHeapBase(wat: string): number {
    const values = [
      ...wat.matchAll(/\(call \$[^\s()]*heap_init(?:_\d+)? \(i32\.const (\d+)\)\)/g),
    ].map((match) => Number(match[1]));
    const generated = values.find((value) => value !== 131072);
    assert(generated !== undefined, "missing generated heap_init call");
    return generated;
  }

  function encodedData(value: string): string {
    return [...Buffer.from(value)]
      .map((byte) => `\\${byte.toString(16).padStart(2, "0")}`)
      .join("");
  }

  test("emits a shared diamond dependency exactly once", async () => {
    const { wat } = await compileProject({
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

    assert.equal(wat.match(/\(func\s+\$[^\s()]*\$\$base(?:_\d+)?(?=\s|\))/g)?.length, 1);
  });

  test("retains the function-reference table, element, and trampoline", async () => {
    const { module, wat } = await compileProject({
      "main.maple": `
        import add from "./ops.maple"
        export fn run(): i32 {
          let op: fn(i32,i32):i32 = add;
          return op(19, 23);
        }
      `,
      "ops.maple": "export fn add(a: i32, b: i32): i32 { return a + b; }",
    });

    assert.match(wat, /\(func\s+\$[^\s()]*\$\$add(?:_\d+)?(?=\s|\))/);
    assert.match(wat, /\(func\s+\$[^\s()]*\$\$__indirect_add(?:_\d+)?(?=\s|\))/);
    assert.match(wat, /\(table\s+\$[^\s()]*fn_table\b\s+1\s+1\s+funcref\s*\)/);
    assert.match(
      wat,
      /\(elem\s+\(i32\.const\s+0\)\s+func\s+\$[^\s()]*\$\$__indirect_add(?:_\d+)?\s*\)/,
    );
    assert(WebAssembly.Module.exports(module).every((entry) => !entry.name.includes("indirect")));
  });

  test("filters unreachable user functions and exports", async () => {
    const { wat } = await compileProject({
      "main.maple": `
        import used, unused_export from "./dep.maple"
        export fn run(): i32 { return used(); }
      `,
      "dep.maple": `
        fn unused_private(): i32 { return 1; }
        export fn unused_export(): i32 { return 2; }
        export fn used(): i32 { return 42; }
      `,
    });

    assert.match(wat, /\(func\s+\$[^\s()]*\$\$used(?:_\d+)?(?=\s|\))/);
    assert.doesNotMatch(wat, /\(func\s+\$[^\s()]*\$\$unused_(?:private|export)(?:_\d+)?(?=\s|\))/);
  });

  test("does not create a table for unreachable function references", async () => {
    const { wat } = await compileProject({
      "main.maple": `
        fn target(value: i32): i32 { return value + 1; }
        fn unused(): i32 {
          let ref: fn(i32):i32 = target;
          return ref(1);
        }
        export fn run(): i32 { return 42; }
      `,
    });

    assert.doesNotMatch(wat, /\(func\s+\$[^\s()]*\$\$(?:target|unused)(?:_\d+)?(?=\s|\))/);
    assert.doesNotMatch(wat, /\(table\s+\$[^\s()]*fn_table\b/);
  });

  test("retains functions reached only from startup", async () => {
    const { wat } = await compileProject({
      "main.maple": `
        fn seed(): i32 { return 42; }
        let initialized: i32 = seed();
        export fn run(): i32 { return initialized; }
      `,
    });

    assert.match(wat, /\(func\s+\$[^\s()]*\$\$seed(?:_\d+)?(?=\s|\))/);
  });

  test("filters unused stdlib function chains", async () => {
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

    assert.doesNotMatch(unused.wat, /\(func\s+\$[^\s()]*\$\$(?:sqrt|sin)(?:_\d+)?(?=\s|\))/);
    assert.match(used.wat, /\(func\s+\$[^\s()]*\$\$sqrt(?:_\d+)?(?=\s|\))/);
    assert.doesNotMatch(used.wat, /\(func\s+\$[^\s()]*\$\$sin(?:_\d+)?(?=\s|\))/);
  });

  test("emits deterministic WAT before and after filtering", async () => {
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
    assert.deepEqual(first.bytes, second.bytes);
    assert.doesNotMatch(first.wat, /\(func\s+\$[^\s()]*\$\$unused(?:_\d+)?(?=\s|\))/);
  });

  test("shakes dead literal data before laying out the heap", async () => {
    const heavyLiteral = `dead-${"x".repeat(512)}`;
    const liveLiteral = "live-data";
    const source = (useHeavy: boolean) => `
      import malloc from "memory"
      fn heavy(): i32 {
        let text: string = "${heavyLiteral}";
        return text.len;
      }
      export fn run(): i32 {
        let text: string = "${liveLiteral}";
        let block: i32 = malloc(8);
        return text.len + (block - block)${useHeavy ? " + heavy()" : ""};
      }
    `;
    const shaken = await compileProject({ "main.maple": source(false) });
    const retained = await compileProject({ "main.maple": source(true) });

    assert(shaken.wat.includes(encodedData(liveLiteral)));
    assert(!shaken.wat.includes(encodedData(heavyLiteral)));
    assert(retained.wat.includes(encodedData(heavyLiteral)));
    assert(wiredHeapBase(shaken.wat) < wiredHeapBase(retained.wat));
  });

  test("structural regexes tolerate equivalent reformatting", () => {
    assert.match(
      "(table\n  $generated_fn_table\n  1  1\n  funcref)",
      /\(table\s+\$[^\s()]*fn_table\b\s+1\s+1\s+funcref\s*\)/,
    );
    assert.match(
      "(elem\n (i32.const 0)\n func\n $prefix$$__indirect_add)",
      /\(elem\s+\(i32\.const\s+0\)\s+func\s+\$[^\s()]*\$\$__indirect_add(?:_\d+)?\s*\)/,
    );
  });
});

describe("Compiler: merged whole-program emission", () => {
  test("runs a two-module program as one wasm module", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        import add from "./math.maple"
        export fn run(): i32 { return add(20, 22); }
      `,
      "math.maple": "export fn add(a: i32, b: i32): i32 { return a + b; }",
    });

    assert.equal(call(instance, "run"), 42);
  });

  test("emits a diamond dependency once", async () => {
    const { instance } = await compileProject({
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
  });

  test("isolates private collisions and identical string literals", async () => {
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

  test("relocates distinct data from multiple modules", async () => {
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

  test("relocates only pointer fields in merged data", async () => {
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

  test("exports owned memory and only entry-module API names", async () => {
    const { instance, module } = await compileProject({
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
  });

  test("preserves an alloc export when function references need malloc", async () => {
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

  test("keeps same-named struct equality helpers module-local", async () => {
    const { instance } = await compileProject({
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
  });

  test("takes a function reference from another merged module", async () => {
    const { instance } = await compileProject({
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
  });

  test("merges malloc and sqrt with module-owned memory", async () => {
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

  test("starts the merged heap above static data without corrupting literals", async () => {
    const { instance } = await compileProject({
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

    const pointer = call(instance, "run") as number;
    assert(pointer > 65_536);
    assert.equal(pointer % 8, 0);
  });

  test("mixes heap, shadow-stack structs, and string literals", async () => {
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

  test("sizes memory and the heap from more than one page of static data", async () => {
    const literals = Array.from({ length: 72 }, (_, index) => {
      const contents = `${"x".repeat(1016)}-${index.toString().padStart(3, "0")}`;
      return `let static_${index}: string = "${contents}";`;
    }).join("\n");
    const liveReads = Array.from(
      { length: 72 },
      (_, index) => `total += static_${index}.len;`,
    ).join("\n");
    const { instance } = await compileProject({
      "main.maple": `
        import malloc from "memory"
        ${literals}
        let expected: string = "${"x".repeat(1016)}-071";

        export fn allocate(): i32 {
          let total: i32 = 0;
          ${liveReads}
          if (total == 0) { return 0; }
          if (static_71 != expected) { return 0; }
          return malloc(8);
        }
        export fn pages(): i32 { return __memory_size(); }
      `,
    });

    const pages = call(instance, "pages") as number;
    const pointer = call(instance, "allocate") as number;
    assert(pages > 2);
    assert(pointer > 2 * 65_536);
    assert(pointer + 8 <= pages * 65_536);
  });

  // T62's central claim: `needsFnrefCreation` no longer forces malloc into
  // the program, so a module using only named fn-refs links no allocator.
  test("a program using only named fn-references links no allocator", async () => {
    const { wat } = await compileProject({
      "main.maple": `
        fn add(a: i32, b: i32): i32 { return a + b; }
        export fn run(): i32 { let op: fn(i32,i32): i32 = add; return op(1, 2); }
      `,
    });

    assert.doesNotMatch(wat, /__make_fnref|\$malloc|\$free|__heap_init/);
  });

  test("the region guard costs nothing when free is unreachable", async () => {
    const { wat } = await compileProject({
      "main.maple": `
        import malloc from "memory"
        export fn run(): i32 { return malloc(8); }
      `,
    });

    assert.doesNotMatch(wat, /is_live_heap/);
  });

  // T57 removed the capability this replaces: resetting the heap invalidates
  // every live pointer, so `__heap_init` is compiler-internal and unimportable.
  test("rejects importing the compiler-internal heap initializer", async () => {
    const errors = await projectErrors({
      "main.maple": `
        import malloc, __heap_init from "memory"
        export fn run(): i32 { return malloc(8); }
      `,
    });

    assert(errors.some((error) => /compiler-internal/.test(error)));
  });

  test("runs deferred global initializers in dependency post-order", async () => {
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

  test("makes dependency-ordered globals readable immediately after instantiation", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        import base from "./dependency.maple"
        export const answer: i32 = base + 1;
      `,
      "dependency.maple": `
        fn seed(): i32 { return 41; }
        export let base: i32 = seed();
      `,
    });

    assert.equal((instance.exports.answer as WebAssembly.Global).value, 42);
  });

  test("surfaces deferred initializer traps during instantiation", async () => {
    await assert.rejects(
      () =>
        compileProject({
          "main.maple": `
            struct Box { value: i32 }
            let box: Box = { value = [1][2] };
            export fn run(): i32 { return box.value; }
          `,
        }),
      WebAssembly.RuntimeError,
    );
  });

  test("does not require a linker executable on PATH", async () => {
    const node = execFileSync("which", ["node"], { encoding: "utf8" }).trim();
    const originalPath = process.env.PATH;
    process.env.PATH = path.dirname(node);
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
  test("removes unreachable private functions from imported modules", async () => {
    const { instance } = await compileProject({
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
  });

  test("removes unreachable exports from non-entry modules", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        import unused from "./dep.maple"
        export fn run(): i32 { return 1; }
      `,
      "dep.maple": "export fn unused(): i32 { return 2; }",
    });

    assert.equal(call(instance, "run"), 1);
  });

  test("keeps cross-module functions reached only through fn-refs callable", async () => {
    const { instance, module } = await compileProject({
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
    assert(
      WebAssembly.Module.exports(module).every((entry) => !entry.name.includes("__indirect_")),
    );
  });

  test("does not slot fn-refs created only by unreachable code", async () => {
    const { instance } = await compileProject({
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
  });

  test("keeps functions reached only from startup initialization", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        fn seed(): i32 { return 42; }
        let initialized: i32 = seed();
        export fn run(): i32 { return initialized; }
      `,
    });

    assert.equal(call(instance, "run"), 42);
  });

  test("emits only the used stdlib function chain", async () => {
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
    assert.equal(call(used.instance, "run"), 4);
  });

  test("shakes dead literal data before laying out the heap", async () => {
    const heavyLiteral = `dead-${"x".repeat(512)}`;
    const liveLiteral = "live-data";
    const source = (useHeavy: boolean) => `
      import malloc from "memory"
      fn heavy(): i32 {
        let text: string = "${heavyLiteral}";
        return text.len;
      }
      export fn run(): i32 {
        let text: string = "${liveLiteral}";
        let block: i32 = malloc(8);
        return text.len + (block - block)${useHeavy ? " + heavy()" : ""};
      }
    `;
    const shaken = await compileProject({ "main.maple": source(false) });
    const retained = await compileProject({ "main.maple": source(true) });

    assert.equal(call(shaken.instance, "run"), liveLiteral.length);
    assert.equal(call(retained.instance, "run"), liveLiteral.length + heavyLiteral.length);
  });

  test("type-checks unreachable code before shaking", async () => {
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
});

describe("Compiler: merged-program acceptance", () => {
  test("uses an imported math struct", async () => {
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

  test("uses an imported user struct across three modules", async () => {
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

  test("materializes a global literal of an imported struct type", async () => {
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

  test("does not wire heap startup to a user stdlib path lookalike", async () => {
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
        export fn __heap_init(data_end: i32): void { calls = calls + 1; }
        export fn spoof_calls(): i32 { return calls; }
      `,
    });

    assert.equal(call(instance, "run"), 0);
  });

  test("rejects identical layouts with different nominal identities", async () => {
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

  test("rejects duplicate imported names across declaration kinds", async () => {
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

  test("compiles and instantiates every demo", async () => {
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

  test("runs the CLI with only npm-provided build tools", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "maple-cli-"));
    try {
      const output = path.join(outputDir, "app.wasm");
      const npm = execFileSync("which", ["npm"], { encoding: "utf8" }).trim();
      const node = execFileSync("which", ["node"], { encoding: "utf8" }).trim();
      const toolFreePath = [
        ...new Set([
          path.dirname(npm),
          path.dirname(node),
          path.dirname(process.env.SHELL ?? "/bin/sh"),
          "/usr/bin",
        ]),
      ].join(path.delimiter);
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
      const bytes = await readFile(output);
      assert.equal(existsSync(path.join(outputDir, "app.wat")), false);
      const { instance } = instantiate(bytes);
      assert.equal(call(instance, "_start", 2, 3), 10);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

describe("defer: reachability", () => {
  // L4: without a call edge from inside the defer, this `free` is tree-shaken,
  // the allocator disappears, and the program links but leaks.
  test("a free reachable only through a defer still links the allocator", async () => {
    const { wat, instance } = await compileProject({
      "main.maple": `
        import malloc, free from "memory"
        export fn run(): i32 {
          let p: i32 = malloc(16);
          defer free(p);
          return p;
        }
      `,
    });

    assert.match(wat, /\(func \$[^\s()]*\$\$free(?:_\d+)?[\s(]/);
    assert(Number(call(instance, "run")) > 0);
  });

  test("a defer inside a start-reached initializer runs at instantiation", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        let trace: i32 = 0;
        fn note(): void { trace = trace + 5; }
        fn build(): i32 { defer note(); return 7; }
        let table: i32 = build();
        export fn run(): i32 { return table * 100 + trace; }
      `,
    });

    assert.equal(call(instance, "run"), 705);
  });
});

// T68 — the zero-cost proof. Design S was chosen over the flag and
// runtime-stack alternatives precisely because a program with no `defer` pays
// NOTHING. This asserts that instead of claiming it.
//
// The golden was first generated against a build with the defer hooks stubbed
// out, and matched the real build byte for byte on all 15 demos — that is the
// measurement behind the claim. It was then regenerated once, by T71, which
// legitimately moved 4 of the 15 (non-escaping local literals gained frame
// storage, and their now-dead static headers stopped being emitted).
// Regenerate ONLY with the reason in the commit message.
describe("defer: zero cost when unused", () => {
  test("the defer-free demo corpus compiles to unchanged bytes", async () => {
    const goldenPath = path.join(repoRoot, "test", "fixtures", "defer-zero-cost.json");
    const golden = JSON.parse(await readFile(goldenPath, "utf8")) as Record<string, string>;
    const demoRoot = path.join(repoRoot, "demo");
    const directories = (await readdir(demoRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    assert.deepEqual(directories, Object.keys(golden).sort(), "demo corpus changed");
    for (const directory of directories) {
      const { bytes } = await compileEntry(path.join(demoRoot, directory, "main.maple"));
      const digest = createHash("sha256").update(bytes).digest("hex");
      assert.equal(digest, golden[directory], `${directory} bytes changed`);
    }
  });
});

describe("allocator modules", () => {
  test("two reachable allocator modules is a compile error", async () => {
    await assert.rejects(
      compileProject({
        "main.maple": `
          import malloc from "memory"
          import free from "memory_debug"
          export fn run(): i32 { let p: i32 = malloc(8); free(p); return p; }
        `,
      }),
      /only one allocator module may be reachable/,
    );
  });

  test("memory_debug wires startup like memory does", async () => {
    const { instance } = await compileProject({
      "main.maple": `
        import malloc from "memory_debug"
        let label: string = "static data pushes the heap base up";
        export fn run(): i32 { return malloc(8); }
      `,
    });

    assert(Number(call(instance, "run")) > 65_536);
  });
});

// §47: every statement walker dispatches on `instanceof` and falls off the end
// silently for a shape it does not know, so a new statement form goes missing
// rather than failing a build. `defer` hit that twice during phase 5 (the
// static-data planner, then the escape analysis). This makes the enumeration
// executable: `while` reaches every walker, so any file that handles `while`
// must handle `defer` too.
describe("statement walkers", () => {
  test("every walker that handles while also handles defer", async () => {
    const srcRoot = path.join(repoRoot, "src");
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    await walk(srcRoot);

    const missing: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      if (!text.includes("instanceof WhileStatement")) continue;
      if (text.includes("instanceof DeferStatement")) continue;
      // flow.ts is the one deliberate exception: falling through to
      // `return false` is already correct, since a defer never terminates.
      if (path.basename(file) === "flow.ts") continue;
      missing.push(path.relative(repoRoot, file));
    }

    assert.deepEqual(missing, [], `statement walkers missing DeferStatement: ${missing}`);
  });
});

describe("memory_debug is opt-in", () => {
  test("importing memory does not drag in memory_debug", async () => {
    const { wat } = await compileProject({
      "main.maple": `
        import malloc, free from "memory"
        export fn run(): i32 { let p: i32 = malloc(8); free(p); return 1; }
      `,
    });

    assert.doesNotMatch(wat, /memory_debug/);
    assert.doesNotMatch(wat, /heap_stats|heap_errors|\$poison/);
  });
});
