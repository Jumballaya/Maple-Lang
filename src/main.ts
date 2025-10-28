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
  compiler(entry, parsed.name, parsed.dir);
}
main();
