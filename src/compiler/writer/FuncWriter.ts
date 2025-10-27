import { Writer } from "./Writer.js";
import type { IWriter } from "./writer.type.js";

export class FuncWriter extends Writer implements IWriter {
  private onEnd?: undefined | ((wat: string) => void);

  constructor(onEnd?: (wat: string) => void) {
    super();
    this.onEnd = onEnd;
  }

  public end(): string {
    const wat = this.toString();
    this.onEnd?.(wat);
    return wat;
  }
}
