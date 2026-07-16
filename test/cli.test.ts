import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const entry = "demo/01_functions_imports/main.maple";
const secondEntry = "demo/02_struct/main.maple";

function runCli(args: string[]) {
  return spawnSync(process.execPath, [path.join(repoRoot, "dist/main.js"), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

describe("CLI argument parsing", () => {
  test("supports both memory modes and enforces the strict flag contract", {
    timeout: 60_000,
  }, () => {
    execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });
    const dir = mkdtempSync(path.join(tmpdir(), "maple-cli-flags-"));
    try {
      const ownedOutput = path.join(dir, "owned.wasm");
      const owned = runCli([entry, "-o", ownedOutput]);
      assert.equal(owned.status, 0, `${owned.stdout}\n${owned.stderr}`);
      const ownedWat = readFileSync(ownedOutput.replace(/\.wasm$/, ".wat"), "utf8");
      assert.match(ownedWat, /\(memory \(export "memory"\) \d+\)/);
      assert.doesNotMatch(ownedWat, /\(import "runtime" "memory"/);

      const importedOutput = path.join(dir, "imported.wasm");
      const imported = spawnSync(
        "npm",
        ["start", "--", "--import-memory", "--import-memory", entry, "--output", importedOutput],
        { cwd: repoRoot, encoding: "utf8" },
      );
      assert.equal(imported.status, 0, `${imported.stdout}\n${imported.stderr}`);
      const importedWat = readFileSync(importedOutput.replace(/\.wasm$/, ".wat"), "utf8");
      assert.match(importedWat, /\(import "runtime" "memory" \(memory \d+\)\)/);
      assert.doesNotMatch(importedWat, /\(memory \(export "memory"\)/);

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
});
