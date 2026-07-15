type ModuleSections = {
  globals: string[];
  data: string[];
  functions: string[];
  signatures: string[];
  imports: string[];
  tables: string[];
  elem: string[];
};

export class MapleModule {
  private sections: ModuleSections = {
    globals: [],
    data: [],
    functions: [],
    signatures: [],
    imports: [],
    tables: [],
    elem: [],
  };

  public readonly name: string;
  private readonly memoryMinimumPages: number;

  constructor(name: string, sections: ModuleSections, memoryMinimumPages = 2) {
    this.sections = sections;
    this.name = name;
    this.memoryMinimumPages = memoryMinimumPages;
  }

  public buildWat(): string {
    const out: string[] = ["(module"];

    out.push(`  (import "runtime" "memory" (memory ${this.memoryMinimumPages}))`);
    for (const s of this.sections.imports) out.push(`  ${s}`);
    for (const s of this.sections.tables) out.push(`  ${s}`);
    for (const s of this.sections.globals) out.push(`  ${s}`);
    for (const s of this.sections.signatures) out.push(`  ${s}`);
    for (const s of this.sections.functions) out.push(`  ${s}`);
    for (const s of this.sections.data) out.push(`  ${s}`);
    for (const s of this.sections.elem) out.push(`  ${s}`);
    out.push(")");
    return out.join("\n");
  }
}

export function minimumMemoryPages(dataEnd: number): number {
  return Math.max(2, Math.ceil(dataEnd / 65_536) + 1);
}
