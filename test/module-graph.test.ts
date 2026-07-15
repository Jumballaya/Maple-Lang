import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  buildModuleGraph,
  type ModuleResolver,
  mangleModuleKey,
  resolveImportModule,
} from "../src/compiler/module-graph";

function withFiles<T>(files: Record<string, string>, run: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), "maple-module-graph-"));
  try {
    for (const [relativePath, source] of Object.entries(files)) {
      const filePath = path.join(dir, relativePath);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, source);
    }
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function moduleKeys(entryPath: string): string[] {
  return [...buildModuleGraph(entryPath).modules.keys()];
}

describe("Module graph", () => {
  test("keeps duplicate basenames distinct and resolves both exports", () => {
    withFiles(
      {
        "main.maple": `
          import from_a from "./a/utils.maple"
          import from_b from "./b/utils.maple"
          export fn call_a(): i32 { return from_a(); }
          export fn call_b(): i32 { return from_b(); }
        `,
        "a/utils.maple": "export fn from_a(): i32 { return 1; }",
        "b/utils.maple": "export fn from_b(): i32 { return 2; }",
      },
      (dir) => {
        const graph = buildModuleGraph(path.join(dir, "main.maple"));
        assert.deepEqual([...graph.modules.keys()], ["main", "a/utils", "b/utils"]);
        assert(graph.modules.get("a/utils")?.data.exports.from_a);
        assert(graph.modules.get("b/utils")?.data.exports.from_b);
        assert.deepEqual(
          graph.modules.get("main")?.dependencies.map((dependency) => dependency.key),
          ["a/utils", "b/utils"],
        );
      },
    );
  });

  test("deduplicates one file reached through two import spellings", () => {
    withFiles(
      {
        "main.maple": `
          import direct from "./c/d.maple"
          import indirect from "./c/e.maple"
          export fn both(): i32 { return direct() + indirect(); }
        `,
        "c/d.maple": "export fn direct(): i32 { return 1; }",
        "c/e.maple": `
          import direct from "./d.maple"
          export fn indirect(): i32 { return direct(); }
        `,
      },
      (dir) => {
        const graph = buildModuleGraph(path.join(dir, "main.maple"));
        assert.equal([...graph.modules.keys()].filter((key) => key === "c/d").length, 1);
        assert.equal(graph.modules.size, 3);
        assert.equal(graph.modules.get("main")?.dependencies[0]?.key, "c/d");
        assert.equal(graph.modules.get("c/e")?.dependencies[0]?.key, "c/d");
      },
    );
  });

  test("normalizes separators and preserves entry-relative parent segments", () => {
    withFiles(
      {
        "app/main.maple": `
          import x1 from "./x.maple"
          import x2 from ".//x.maple"
          import shared from "../shared/x.maple"
        `,
        "app/x.maple": "export fn x1(): i32 { return 1; } export fn x2(): i32 { return 2; }",
        "shared/x.maple": "export fn shared(): i32 { return 3; }",
      },
      (dir) => {
        const entryPath = path.join(dir, "app/main.maple");
        assert.deepEqual(moduleKeys(entryPath), ["main", "x", "../shared/x"]);
        assert.equal(
          buildModuleGraph(entryPath).modules.get("../shared/x")?.manglePrefix,
          "$2E$2E$2Fshared$2Fx",
        );
      },
    );
  });

  test("reports import cycles from the first repeated module", () => {
    withFiles(
      {
        "main.maple": 'import a from "./a.maple"',
        "a.maple": 'import b from "./b.maple" export fn a(): i32 { return b(); }',
        "b.maple": 'import a from "./a.maple" export fn b(): i32 { return a(); }',
      },
      (dir) => {
        assert.throws(
          () => buildModuleGraph(path.join(dir, "main.maple")),
          new Error("import cycle: a -> b -> a"),
        );
      },
    );

    withFiles(
      {
        "a.maple": 'import a from "./a.maple"',
      },
      (dir) => {
        assert.throws(
          () => buildModuleGraph(path.join(dir, "a.maple")),
          new Error("import cycle: a -> a"),
        );
      },
    );
  });

  test("missing-module errors contain the resolved absolute path", () => {
    withFiles(
      {
        "main.maple": 'import missing from "./nested/missing.maple"',
      },
      (dir) => {
        const missingPath = path.resolve(dir, "nested/missing.maple");
        assert.throws(
          () => buildModuleGraph(path.join(dir, "main.maple")),
          (error: unknown) => error instanceof Error && error.message.includes(missingPath),
        );
      },
    );
  });

  test("stores injective UTF-8 mangle prefixes", () => {
    withFiles(
      {
        "main.maple": `
          import dash from "./a-b.maple"
          import dot from "./a.b.maple"
          import slash from "./a/b.maple"
          import unicode from "./héllo.maple"
        `,
        "a-b.maple": "export fn dash(): i32 { return 1; }",
        "a.b.maple": "export fn dot(): i32 { return 2; }",
        "a/b.maple": "export fn slash(): i32 { return 3; }",
        "héllo.maple": "export fn unicode(): i32 { return 4; }",
      },
      (dir) => {
        const graph = buildModuleGraph(path.join(dir, "main.maple"));
        const prefixes = ["a-b", "a.b", "a/b"].map((key) => graph.modules.get(key)?.manglePrefix);
        assert.deepEqual(prefixes, ["a$2Db", "a$2Eb", "a$2Fb"]);
        assert.equal(new Set(prefixes).size, 3);
        assert.equal(graph.modules.get("héllo")?.manglePrefix, "h$C3$A9llo");
        assert.equal(mangleModuleKey("a$b"), "a$24b");
      },
    );
  });

  test("builds both demos and treats stdlib math as an ordinary file module", () => {
    const functionsDir = path.resolve("demo/01_functions_imports");
    const functionsGraph = buildModuleGraph(path.join(functionsDir, "main.maple"));
    assert.deepEqual([...functionsGraph.modules.keys()], ["main", "math"]);

    const everythingDir = path.resolve("demo/99_everything");
    const everythingGraph = buildModuleGraph(path.join(everythingDir, "main.maple"));
    const stdlibMathKey = path.posix
      .normalize(
        path
          .relative(everythingDir, path.resolve("src/compiler/stdlib/math.maple"))
          .replaceAll("\\", "/"),
      )
      .replace(/\.maple$/, "");
    assert(everythingGraph.modules.has("math"));
    const stdlibMath = everythingGraph.modules.get(stdlibMathKey);
    assert.equal(stdlibMath?.kind, "maple");
    assert.equal(stdlibMath?.filePath, path.resolve("src/compiler/stdlib/math.maple"));
  });

  test("records file-less external resolutions as childless cycle-exempt leaves", () => {
    withFiles(
      {
        "main.maple": 'import host_fn from "./main.maple"',
      },
      (dir) => {
        const resolver: ModuleResolver = (specifier, importerDir) =>
          specifier === "./main.maple"
            ? { kind: "external" }
            : resolveImportModule(specifier, importerDir);
        const graph = buildModuleGraph(path.join(dir, "main.maple"), { resolver });
        assert.equal(graph.modules.size, 1);
        assert.equal(graph.externals.length, 1);
        assert.deepEqual(graph.externals[0], {
          kind: "external",
          specifier: "./main.maple",
          importerKey: "main",
          filePath: undefined,
          children: [],
        });
        assert.equal(graph.modules.get("main")?.dependencies[0]?.kind, "external");
      },
    );
  });

  test("produces deterministic records", () => {
    withFiles(
      {
        "main.maple": 'import child from "./child.maple"',
        "child.maple": "export fn child(): i32 { return 1; }",
      },
      (dir) => {
        const entryPath = path.join(dir, "main.maple");
        assert.deepEqual(buildModuleGraph(entryPath), buildModuleGraph(entryPath));
      },
    );
  });
});
