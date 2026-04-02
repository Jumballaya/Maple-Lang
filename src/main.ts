import path from "node:path";
import { compiler } from "./compiler/compiler";
import { MapleError } from "./compiler/errors";

const usage = `Usage: maple <file> [optional_arg]
Compiles a maple source code file into a .wasm file

Options:
  -o, --output <file>   Specify output file (default: <input>.wasm)

Examples:
  maple src/main.maple
  maple src/main.maple -o app.wasm
`;

async function main() {
  const args = process.argv.slice(2);
  const entry = args[0];
  if (!entry) {
    console.log(usage);
    return;
  }

  let outputPath = "build/app.wasm";
  const oIndex = args.indexOf("-o") !== -1 ? args.indexOf("-o") : args.indexOf("--output");
  const outputArg = oIndex !== -1 ? args[oIndex + 1] : undefined;
  if (outputArg !== undefined) {
    outputPath = outputArg;
  }

  const parsed = path.parse(entry);
  try {
    await compiler(entry, parsed.name, parsed.dir, outputPath);
  } catch (e) {
    if (e instanceof MapleError) {
      console.error(e.format());
    } else {
      console.error("Error: ", e);
    }
    process.exit(1);
  }
}
main();
