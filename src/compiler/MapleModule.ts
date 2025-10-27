type ModuleSections = {
  globals: string[];
  data: string[];
  functions: string[];
  signatures: string[];
  imports: string[];
};

export class MapleModule {
  private sections: ModuleSections = {
    globals: [],
    data: [],
    functions: [],
    signatures: [],
    imports: [],
  };

  public readonly name: string;

  constructor(name: string, sections: ModuleSections) {
    this.sections = sections;
    this.name = name;
  }

  public buildWat(): string {
    const out: string[] = ["(module"];

    out.push(`(import "runtime" "memory" (memory 2))`);

    for (const s of this.sections.signatures) out.push("  " + s);
    for (const s of this.sections.imports) out.push("  " + s);
    for (const s of this.sections.globals) out.push("  " + s);
    for (const s of this.sections.data) out.push("  " + s);
    for (const s of this.sections.functions) out.push("  " + s);
    out.push(")");
    return out.join("\n");
  }
}
