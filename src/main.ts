import { Lexer } from "./lexer/Lexer.js";
import type { StringToken } from "./lexer/token.types.js";

const decoder = new TextDecoder();
function decodeStringToken(token: StringToken): string {
  const u8 = token.literal;
  return decoder.decode(u8);
}

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
  const lexer = new Lexer(`'\\x41'`);
  const tokens = lexer.getTokens();

  console.log(tokens);
}
main();
