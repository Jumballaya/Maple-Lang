import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe } from "node:test";
import { compiler } from "../src/compiler/compiler";
import { maybeTest, memoryMinimumFromWat } from "./helpers";

const source = `
  import malloc from "memory"
  let marker: string = "owned-memory";

  export fn marker_len(): i32 { return marker.len; }
  export fn grow_past_initial(): i32 {
    let before: i32 = __memory_size();
    let block: i32 = malloc((before * 65536) + 1);
    let after: i32 = __memory_size();
    if (block == 0) { return 0; }
    return after > before;
  }
`;

async function compileMode(importMemory: boolean): Promise<{
  bytes: Uint8Array;
  wat: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "maple-memory-mode-"));
  try {
    const entry = path.join(dir, "main.maple");
    const output = path.join(dir, "app.wasm");
    const watPath = path.join(dir, "app.wat");
    await writeFile(entry, source);
    await compiler(entry, "main", dir, output, { importMemory, emitWat: watPath });
    return {
      bytes: await readFile(output),
      wat: await readFile(watPath, "utf8"),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function exportedFunction(instance: WebAssembly.Instance, name: string): () => number {
  const value = instance.exports[name];
  assert.equal(typeof value, "function");
  return value as () => number;
}

function assertStaticMarker(wat: string, memory: WebAssembly.Memory): void {
  const expected = new TextEncoder().encode("owned-memory");
  const encoded = [...expected].map((value) => `\\${value.toString(16).padStart(2, "0")}`).join("");
  const segment = wat.split("\n").find((line) => line.includes(encoded));
  assert(segment, "expected the marker in a model-assigned data segment");
  const addressMatch = segment.match(/i32\.const (\d+)/);
  assert(addressMatch, "expected a static data address");
  const address = Number(addressMatch[1]);
  const bytes = new Uint8Array(memory.buffer);
  assert.deepEqual(bytes.slice(address, address + expected.length), expected);
}

describe("memory ownership modes", () => {
  maybeTest("programmatic default owns memory and import mode uses the same minimum", async () => {
    const owned = await compileMode(false);
    assert.match(owned.wat, /\(memory \(export "memory"\) \d+\)/);
    assert.doesNotMatch(owned.wat, /\(import "runtime" "memory"/);

    const ownedBytes = new Uint8Array(owned.bytes.byteLength);
    ownedBytes.set(owned.bytes);
    const ownedModule = new WebAssembly.Module(ownedBytes);
    assert.deepEqual(WebAssembly.Module.imports(ownedModule), []);
    const ownedInstance = new WebAssembly.Instance(ownedModule);
    const ownedMemory = ownedInstance.exports.memory;
    assert(ownedMemory instanceof WebAssembly.Memory);
    assertStaticMarker(owned.wat, ownedMemory);
    assert.equal(exportedFunction(ownedInstance, "marker_len")(), 12);
    assert.equal(exportedFunction(ownedInstance, "grow_past_initial")(), 1);

    const imported = await compileMode(true);
    assert.match(imported.wat, /\(import "runtime" "memory" \(memory \d+\)\)/);
    assert.doesNotMatch(imported.wat, /\(memory \(export "memory"\)/);
    assert.equal(memoryMinimumFromWat(imported.wat), memoryMinimumFromWat(owned.wat));

    const importedBytes = new Uint8Array(imported.bytes.byteLength);
    importedBytes.set(imported.bytes);
    const importedModule = new WebAssembly.Module(importedBytes);
    assert.deepEqual(WebAssembly.Module.imports(importedModule), [
      { module: "runtime", name: "memory", kind: "memory" },
    ]);
    assert.throws(() => new WebAssembly.Instance(importedModule));
    const importedMemory = new WebAssembly.Memory({
      initial: memoryMinimumFromWat(imported.wat),
    });
    const importedInstance = new WebAssembly.Instance(importedModule, {
      runtime: { memory: importedMemory },
    });
    assert.equal(importedInstance.exports.memory, undefined);
    assertStaticMarker(imported.wat, importedMemory);
    assert.equal(exportedFunction(importedInstance, "marker_len")(), 12);
    assert.equal(exportedFunction(importedInstance, "grow_past_initial")(), 1);
  });
});
