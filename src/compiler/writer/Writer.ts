import type { IWriter } from "./writer.type.js";

export class Writer implements IWriter {
  private lines: string[] = [];
  private cur: string[] = [];
  private indent = 0;
  private tab = "  ";

  // appends the string to the current line
  public append(s: string) {
    this.cur.push(s);
  }

  public newLine() {
    if (this.cur.length > 0) {
      this.lines.push(this.tab.repeat(this.indent) + this.cur.join(""));
    }
    this.cur.length = 0;
  }

  public line(s = "") {
    this.cur = [s];
    this.newLine();
  }

  public open(s?: string) {
    if (s) {
      this.line(s);
    }
    this.tabIn();
  }

  public close(s?: string) {
    this.untab();
    if (s) {
      this.line(s);
    }
  }

  public tabIn() {
    this.indent++;
  }

  public untab() {
    this.indent = Math.max(0, this.indent - 1);
  }

  public raw(s = "") {
    this.lines.push(s);
  }

  public toString(): string {
    this.newLine();
    return this.lines.filter(Boolean).join("\n");
  }
}
