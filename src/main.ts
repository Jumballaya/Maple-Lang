import path from "node:path";
import { compiler } from "./compiler/compiler";
import { MapleError } from "./compiler/errors";

const usage = `Usage: maple [options] <file>
Compiles a maple source code file into a .wasm file

Options:
  -o, --output <file>   Specify output file (default: build/app.wasm)
  --import-memory       Import runtime.memory instead of exporting owned memory

Examples:
  maple src/main.maple
  maple src/main.maple -o app.wasm
  maple --import-memory src/main.maple
`;

type CliOptions = {
  entry: string;
  outputPath: string;
  importMemory: boolean;
};

function parseArgs(args: string[]): CliOptions {
  let entry: string | undefined;
  let outputPath = "build/app.wasm";
  let outputSeen = false;
  let importMemory = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--import-memory") {
      importMemory = true;
      continue;
    }
    if (arg === "-o" || arg === "--output") {
      if (outputSeen) throw new Error(`${arg} may only be specified once`);
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`${arg} requires an output file`);
      }
      outputSeen = true;
      outputPath = value;
      index++;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    if (entry !== undefined) {
      throw new Error(`expected one input file, got both "${entry}" and "${arg}"`);
    }
    entry = arg;
  }

  if (entry === undefined) throw new Error("missing input file");
  return { entry, outputPath, importMemory };
}

async function main() {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage);
    process.exitCode = 1;
    return;
  }

  const parsed = path.parse(options.entry);
  try {
    await compiler(options.entry, parsed.name, parsed.dir, options.outputPath, {
      importMemory: options.importMemory,
    });
  } catch (e) {
    if (e instanceof MapleError) {
      console.error(e.format());
    } else {
      console.error("Error: ", e);
    }
    process.exitCode = 1;
  }
}
main();
