import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { compiler } from "../src/compiler/compiler";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cliPath = path.join(repoRoot, "dist/main.js");
const entry = "demo/01_functions_imports/main.maple";
const entryAbsolute = path.join(repoRoot, entry);
const everythingEntry = "demo/99_everything/main.maple";
const secondEntry = "demo/02_struct/main.maple";

function runCli(args: string[], cwd = repoRoot) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function instantiate(bytes: Buffer, importMemory = false): WebAssembly.Instance {
  const wasmBytes = new Uint8Array(bytes.byteLength);
  wasmBytes.set(bytes);
  const module = new WebAssembly.Module(wasmBytes);
  const imports = importMemory
    ? { runtime: { memory: new WebAssembly.Memory({ initial: 256 }) } }
    : {};
  return new WebAssembly.Instance(module, imports);
}

describe("CLI argument parsing and artifacts", () => {
  before(() => {
    execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });
  });

  test("supports both memory modes and enforces the strict flag contract", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "maple-cli-flags-"));
    try {
      const ownedOutput = path.join(dir, "owned.wasm");
      const ownedWatPath = path.join(dir, "debug", "owned.wat");
      const owned = runCli([entry, "-o", ownedOutput, "--emit-wat", ownedWatPath]);
      assert.equal(owned.status, 0, `${owned.stdout}\n${owned.stderr}`);
      const ownedWat = readFileSync(ownedWatPath, "utf8");
      assert.match(ownedWat, /\(memory \(export "memory"\) \d+\)/);
      assert.doesNotMatch(ownedWat, /\(import "runtime" "memory"/);
      assert.equal(existsSync(path.join(dir, "owned.wat")), false);

      const importedOutput = path.join(dir, "imported.wasm");
      const importedWatPath = path.join(dir, "debug", "imported.wat");
      const imported = runCli([
        "--import-memory",
        "--import-memory",
        entry,
        "--output",
        importedOutput,
        "--emit-wat",
        importedWatPath,
      ]);
      assert.equal(imported.status, 0, `${imported.stdout}\n${imported.stderr}`);
      const importedWat = readFileSync(importedWatPath, "utf8");
      assert.match(importedWat, /\(import "runtime" "memory" \(memory \d+\)\)/);
      assert.doesNotMatch(importedWat, /\(memory \(export "memory"\)/);
      assert.equal(existsSync(path.join(dir, "imported.wat")), false);

      for (const flag of ["--emit-wat", "--emit-ir"]) {
        const repeated = runCli([entry, flag, "first", flag, "second"]);
        assert.equal(repeated.status, 1);
        assert.match(repeated.stderr, new RegExp(`${flag} may only be specified once`));

        const valueless = runCli([entry, flag]);
        assert.equal(valueless.status, 1);
        assert.match(valueless.stderr, new RegExp(`${flag} requires an output file`));
      }

      const typo = runCli([entry, "--import-memroy"]);
      assert.equal(typo.status, 1);
      assert.match(typo.stderr, /Usage: maple/);

      const missingOutput = runCli([entry, "-o"]);
      assert.equal(missingOutput.status, 1);
      assert.match(missingOutput.stderr, /Usage: maple/);

      const repeatedOutput = runCli([entry, "-o", "a.wasm", "-o", "b.wasm"]);
      assert.equal(repeatedOutput.status, 1);
      assert.match(repeatedOutput.stderr, /Usage: maple/);

      const twoInputs = runCli([entry, secondEntry]);
      assert.equal(twoInputs.status, 1);
      assert.match(twoInputs.stderr, new RegExp(entry.replaceAll("/", "\\/")));
      assert.match(twoInputs.stderr, new RegExp(secondEntry.replaceAll("/", "\\/")));

      const missingInput = runCli([]);
      assert.equal(missingInput.status, 1);
      assert.match(missingInput.stderr, /Usage: maple/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("writes IR at the given path with the same deterministic dump as the compiler API", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "maple-cli-ir-"));
    try {
      const cliOutput = path.join(dir, "cli.wasm");
      const cliIr = path.join(dir, "cli.json");
      const directOutput = path.join(dir, "direct.wasm");
      const directIr = path.join(dir, "direct.json");

      const result = runCli([everythingEntry, "-o", cliOutput, "--emit-ir", cliIr]);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      await compiler(
        entryAbsolute.replace(entry, everythingEntry),
        "main",
        repoRoot,
        directOutput,
        {
          importMemory: false,
          emitIr: directIr,
        },
      );

      const cliDump = readFileSync(cliIr, "utf8");
      assert.equal(cliDump, readFileSync(directIr, "utf8"));
      assert.match(cliDump, /"\$bigint": "-?\d+"/);
      assert.match(cliDump, /"\$bytes": "[0-9a-f]+"/);
      assert(cliDump.endsWith("\n"));
      assert(!cliDump.endsWith("\n\n"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("creates nested parents, resolves side paths against cwd, and never derives a WAT path", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "maple-cli-paths-"));
    try {
      const absoluteIr = path.join(dir, "absolute", "module.json");
      const result = runCli(
        [
          entryAbsolute,
          "-o",
          "nested/output/app",
          "--emit-wat",
          "relative/debug/module.wat",
          "--emit-ir",
          absoluteIr,
        ],
        dir,
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert(existsSync(path.join(dir, "nested", "output", "app")));
      assert(existsSync(path.join(dir, "relative", "debug", "module.wat")));
      assert(existsSync(absoluteIr));
      assert.equal(existsSync(path.join(dir, "nested", "output", "app.wat")), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects all resolved path collisions through argv", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "maple-cli-collisions-"));
    try {
      const output = path.join(dir, "app.wasm");
      const cases = [
        {
          args: [entry, "-o", output, "--emit-wat", path.join(dir, ".", "app.wasm")],
          message: "--emit-wat path collides with the output path",
        },
        {
          args: [entry, "-o", output, "--emit-ir", path.join(dir, "nested", "..", "app.wasm")],
          message: "--emit-ir path collides with the output path",
        },
        {
          args: [
            entry,
            "-o",
            output,
            "--emit-wat",
            path.join(dir, "debug", "module.txt"),
            "--emit-ir",
            path.join(dir, "debug", ".", "module.txt"),
          ],
          message: "--emit-ir path collides with --emit-wat",
        },
      ];

      for (const collision of cases) {
        const result = runCli(collision.args);
        assert.equal(result.status, 1);
        assert.match(result.stderr, new RegExp(collision.message));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("strip is idempotent and affects only a strict suffix of the wasm output", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "maple-cli-strip-"));
    try {
      const fullWasm = path.join(dir, "full.wasm");
      const fullWat = path.join(dir, "full.wat");
      const fullIr = path.join(dir, "full.json");
      const strippedWasm = path.join(dir, "stripped.wasm");
      const strippedWat = path.join(dir, "stripped.wat");
      const strippedIr = path.join(dir, "stripped.json");
      const repeatedWasm = path.join(dir, "repeated.wasm");

      const full = runCli([entry, "-o", fullWasm, "--emit-wat", fullWat, "--emit-ir", fullIr]);
      const stripped = runCli([
        entry,
        "-o",
        strippedWasm,
        "--strip",
        "--emit-wat",
        strippedWat,
        "--emit-ir",
        strippedIr,
      ]);
      const repeated = runCli([entry, "-o", repeatedWasm, "--strip", "--strip"]);
      assert.equal(full.status, 0, `${full.stdout}\n${full.stderr}`);
      assert.equal(stripped.status, 0, `${stripped.stdout}\n${stripped.stderr}`);
      assert.equal(repeated.status, 0, `${repeated.stdout}\n${repeated.stderr}`);

      const fullBytes = readFileSync(fullWasm);
      const strippedBytes = readFileSync(strippedWasm);
      assert(fullBytes.length > strippedBytes.length);
      assert.deepEqual(fullBytes.subarray(0, strippedBytes.length), strippedBytes);
      assert.deepEqual(readFileSync(repeatedWasm), strippedBytes);
      assert(instantiate(fullBytes));
      assert(instantiate(strippedBytes));
      assert.equal(readFileSync(fullWat, "utf8"), readFileSync(strippedWat, "utf8"));
      assert.equal(readFileSync(fullIr, "utf8"), readFileSync(strippedIr, "utf8"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a checking failure writes no requested output", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "maple-cli-failure-"));
    try {
      const invalidEntry = path.join(dir, "invalid.maple");
      const output = path.join(dir, "nested", "app.wasm");
      const wat = path.join(dir, "nested", "app.wat");
      const ir = path.join(dir, "nested", "app.json");
      writeFileSync(invalidEntry, "export fn run(): i32 { return 1.5; }");

      runCli([invalidEntry, "-o", output, "--emit-wat", wat, "--emit-ir", ir]);
      assert.equal(existsSync(output), false);
      assert.equal(existsSync(wat), false);
      assert.equal(existsSync(ir), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prints the three pinned option lines without changing Examples", () => {
    const result = runCli(["--unknown"]);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      / {2}--import-memory {7}Import runtime\.memory instead of exporting owned memory\n {2}--emit-wat <file> {5}Also write WebAssembly text \(debug output\)\n {2}--emit-ir <file> {6}Also write the lowered IR as JSON \(debug output\)\n {2}--strip {15}Omit the name section from the \.wasm output\n\nExamples:/,
    );
    assert.match(
      result.stderr,
      /Examples:\n {2}maple src\/main\.maple\n {2}maple src\/main\.maple -o app\.wasm\n {2}maple --import-memory src\/main\.maple\n\n$/,
    );
  });

  test("demo/99_everything instantiates in both memory and strip modes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "maple-cli-everything-"));
    try {
      for (const importMemory of [false, true]) {
        for (const strip of [false, true]) {
          const name = `${importMemory ? "imported" : "owned"}-${strip ? "stripped" : "full"}`;
          const output = path.join(dir, `${name}.wasm`);
          const args = [
            ...(importMemory ? ["--import-memory"] : []),
            ...(strip ? ["--strip"] : []),
            everythingEntry,
            "-o",
            output,
          ];
          const result = runCli(args);
          assert.equal(result.status, 0, `${name}\n${result.stdout}\n${result.stderr}`);
          assert(instantiate(readFileSync(output), importMemory), `${name} did not instantiate`);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
