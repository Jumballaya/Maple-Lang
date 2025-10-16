import { Lexer } from "./lexer/Lexer.js";

const example = `
// this is the top comment
struct string {
  len: i32,
  data: *u8,
}

fn print_string(str: *string): void {
  print(str);
}
`;

async function main() {
  const lexer = new Lexer(example);
  console.log(lexer.getTokens());
}
main();
