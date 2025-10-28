import { Parser } from "./parser/Parser";

const usage = `Usage: maple <file> [optional_arg]
Compiles a maple source code file into a .wasm file

Options:
  -o, --output <file>   Specify output file (default: <input>.wasm)

Examples:
  maple src/main.maple
  maple src/main.maple -o app.wasm
`;

const example = `
// this is the top comment
struct string {
  len: i32,
  data: *u8,
}

fn print_string2(str: *string): void {
  print(str);
}

fn main(): void {
  message: string = "Hello World!";
  print_string2(&message);
}
`;

async function main() {
  const parser = new Parser(example);
  console.log(parser.parse("main"));
}
main();
