import { Lexer } from "./lexer/Lexer.js";

async function main() {
  const lexer = new Lexer("");
  console.log(lexer.getTokens());
}
main();
