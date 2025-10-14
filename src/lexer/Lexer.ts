export class Lexer {
  private text: string;
  private pointer = 0;

  constructor(source: string) {
    this.text = source;
  }
}
