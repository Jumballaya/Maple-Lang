import path from "path";
import { compiler } from "./compiler/compiler";

const usage = `Usage: maple <file> [optional_arg]
Compiles a maple source code file into a .wasm file

Options:
  -o, --output <file>   Specify output file (default: <input>.wasm)

Examples:
  maple src/main.maple
  maple src/main.maple -o app.wasm
`;

async function main() {
  const entry = process.argv[2];
  if (!entry) {
    console.log(usage);
    return;
  }

  const parsed = path.parse(entry);
  try {
    await compiler(entry, parsed.name, parsed.dir);
  } catch (e) {
    console.log("Error: ", e);
  }
}
main();
