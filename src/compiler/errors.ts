export class MapleError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
    public readonly file: string = "",
  ) {
    super(message);
    this.name = "MapleError";
  }

  format(): string {
    const loc = this.file ? `${this.file}:${this.line}:${this.col}` : `${this.line}:${this.col}`;
    return `${loc}: error: ${this.message}`;
  }
}
