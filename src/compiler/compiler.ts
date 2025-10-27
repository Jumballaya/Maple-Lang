import { readFile, writeFile } from "fs/promises";
import { emitModule, extractModuleMeta } from "./emitters/module.js";
import { exec } from "child_process";
import type { ModuleMeta } from "./emitters/emitter.types.js";
import path from "path";
import type { MapleModule } from "./MapleModule.js";
import { ASTProgram } from "../parser/ast/ASTProgram.js";

//
//
//  Compilation
//
//  Part 1. 2 Pass assembler
//
//  pass 1. ASTProgram[] -> ModuleBuilder[] -> ModuleMeta[]
//    Goal: collection of data for dependency resolution
//    - function data
//    - import and export data
//    - struct data
//
//  pass 2. [ASTProgram, ModuleMeta][] -> ModuleEmitter[] -> MapleModule[]
//    Goal: emit chunks of code and organize them in the maple module
//    - stdlib ModuleMetas are hardcoded and the imported ones are pulled in for resolving imports
//    - 2a. resolve import meta data (function signatures, global types, struct data)
//    - 2b. ModuleBuilder takes meta data and ASTProgram and generates the MapleModule
//
//
//  Part 2. Compile and link
//  pass 3. MapleModule[] -> .wat[]
//    Goal: emit .wat files
//    - MapleModule.buildWat() -> fs.writeFile
//
//  pass 4. .wat[] -> .o[]
//    Goal: compile into binaries
//    - wat2wasm each .wasm file to a .o binary
//    - copy stlib .o files into build folder
//
//  pass 5.
//    Goal: link and build final binary
//    - wasm-ld all .o files in the build folder and generate the .wasm file
//

const stdlib: Record<string, ModuleMeta> = {
  math: {
    name: "math",
    dataPtr: 0,
    exports: {
      i_to_f: {
        kind: "func",
        signature: "i_f",
      },
      fraction: {
        kind: "struct",
        meta: {
          name: "fraction",
          size: 8,
          exported: true,
          members: {
            numerator: {
              name: "numerator",
              offset: 0,
              size: 4,
              type: "i32",
            },
            denominator: {
              name: "denominator",
              offset: 4,
              size: 4,
              type: "i32",
            },
          },
        },
      },
    },
    functions: {},
    globals: {},
    imports: {},
    stringPool: {},
    structs: {
      fraction: {
        name: "fraction",
        size: 8,
        exported: true,
        members: {
          numerator: {
            name: "numerator",
            offset: 0,
            size: 4,
            type: "i32",
          },
          denominator: {
            name: "denominator",
            offset: 4,
            size: 4,
            type: "i32",
          },
        },
      },
    },
    data: [],
  },
  memory: {
    name: "memory",
    dataPtr: 0,
    exports: {
      malloc: {
        kind: "func",
        signature: "i_i",
      },
      free: {
        kind: "func",
        signature: "i_v",
      },
      realloc: {
        kind: "func",
        signature: "iii_i",
      },
      string_copy: {
        kind: "func",
        signature: "i_i",
      },
    },
    functions: {},
    globals: {},
    imports: {},
    stringPool: {},
    structs: {},
    data: [],
  },
};

async function getAST(fp: string): Promise<ASTProgram> {
  const res = await readFile(fp);
  const txt = res.toString();
  const json = JSON.parse(txt) as ASTProgram;
  return json;
}

export async function compiler(entryPoint: string, cwd: string) {
  const entryAST = await getAST(entryPoint);
  const data = extractModuleMeta(entryAST);

  const stdLibList: Record<string, ModuleMeta> = {};
  const pass1: Record<string, { data: ModuleMeta; ast: ASTProgram }> = {
    [entryAST.name]: { data, ast: entryAST },
  };

  // 1. Build module data
  for (const imp of Object.values(data.imports)) {
    const stdMod = stdlib[imp.module];
    if (stdMod) {
      stdLibList[imp.module] = stdMod;
      continue;
    }
    const userMod = await getAST(path.join(cwd, imp.module));
    if (!userMod) {
      throw new Error(`unable to find module: ${imp.module}`);
    }
    pass1[imp.module] = { data: extractModuleMeta(userMod), ast: userMod };
  }

  // 2. Link module imports/exports
  for (const mod of Object.values(pass1)) {
    const data = mod.data;
    for (const [impName, imp] of Object.entries(data.imports)) {
      if (imp.resolved) {
        continue;
      }
      // see if we have an stdlib import
      const stdLibEntry = stdLibList[imp.module];
      if (stdLibEntry) {
        const entry = stdLibEntry.exports[impName];
        if (!entry) {
          throw new Error(
            `no function "${impName}" exported from stdlib "${imp.module}"`
          );
        }
        // hook up the export -> import
        imp.info = entry;
        imp.resolved = true;
        continue;
      }
      // now with the user files
      const userEntry = pass1[imp.module];
      if (!userEntry) {
        throw new Error(`no module "${imp.module}" found`);
      }
      const entry = userEntry.data.exports[impName];
      if (!entry) {
        throw new Error(
          `no function "${impName}" exported from stdlib "${imp.module}"`
        );
      }
      // hook up the export -> import
      imp.info = entry;
      imp.resolved = true;
    }
  }

  // step 3. compile
  // Emit code
  const toWrite: MapleModule[] = [];
  for (const mod of Object.values(pass1)) {
    toWrite.push(emitModule(mod.ast, mod.data));
  }

  // create build folder
  await run("mkdir -p build");
  // build .wat files
  const toCompile: string[] = [];
  for (const mod of toWrite) {
    await writeFile(`build/${mod.name}.wat`, mod.buildWat());
    toCompile.push(mod.name);
  }
  // compile to wasm
  for (const path of toCompile) {
    await run(`wat2wasm -r build/${path}.wat -o build/${path}.o`);
  }
  // step 4. Linking
  // 4a. get std lib binaries
  for (const bin of Object.values(stdLibList)) {
    await run(`cp src/compiler/stdlib/${bin.name}.o build/${bin.name}.o`);
  }
  await run("wasm-ld --no-check-features build/*.o -o build/app.wasm");
  ////// Run
  const binary = await readFile("build/app.wasm");
  const memory = new WebAssembly.Memory({ initial: 1 });
  const wasm = (await WebAssembly.instantiate(binary, {
    runtime: { heap_memory: memory },
  })) as any as {
    module: WebAssembly.Module;
    instance: WebAssembly.Instance;
  };
  const module = wasm.instance.exports as {
    _start: (n: number) => number;
  };
  console.log(module._start(14.12312));
}

function run(cmd: string): Promise<void> {
  return new Promise((res) => {
    exec(cmd, (exception, out, err) => {
      if (exception) {
        throw exception;
      }
      if (err) {
        console.error(err);
        return;
      }
      if (out) {
        console.log(out);
      }
      res();
    });
  });
}
