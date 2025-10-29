import type {
  ExportMeta,
  ModuleDataMeta,
  ModuleMeta,
  StructData,
  VariableMeta,
  ImportMeta,
  FunctionMeta,
} from "./emitters/emitter.types.js";
import { alignup } from "./emitters/emit.data.js";

export class ModuleBuilder {
  public readonly name: string;

  private globals: Record<string, VariableMeta> = {};
  private functions: Record<string, FunctionMeta> = {};
  private exports: Record<string, ExportMeta> = {};
  private imports: Record<string, ImportMeta> = {};
  private structs: Record<string, StructData> = {};
  private data: Array<ModuleDataMeta> = [];
  private stringPool: Record<string, number> = {};
  private dataPtr = 1024;

  constructor(name: string) {
    this.name = name;
  }

  public build(): ModuleMeta {
    const {
      name,
      globals,
      functions,
      exports,
      structs,
      data,
      stringPool,
      dataPtr,
      imports,
    } = this;

    return {
      name,
      globals,
      functions,
      exports,
      structs,
      data,
      stringPool,
      dataPtr,
      imports,
    };
  }

  public defGlobal(meta: VariableMeta): void {
    if (this.globals[meta.name]) {
      throw new Error(`Duplicate global definition: ${meta.name}`);
    }
    this.globals[meta.name] = meta;
  }
  public defStruct(struct: StructData): void {
    if (this.structs[struct.name]) {
      throw new Error(`Duplicate struct definition: ${struct.name}`);
    }
    this.structs[struct.name] = struct;
  }
  public defImport(id: string, mod: string, name: string): void {
    if (this.imports[id]) {
      throw new Error(`duplicate import id: ${id}`);
    }
    this.imports[id] = { module: mod, name, resolved: false };
  }
  public defExport(name: string, meta: ExportMeta): void {
    if (this.exports[name]) {
      throw new Error(`duplicate export: ${name}`);
    }
    this.exports[name] = meta;
  }
  public defFunc(name: string, meta: FunctionMeta) {
    if (this.functions[name]) {
      throw new Error(`duplicate function: ${name}`);
    }
    this.functions[name] = meta;
  }

  public getStruct(name: string): StructData | undefined {
    return this.structs[name];
  }
  public getGlobal(name: string): VariableMeta | undefined {
    return this.globals[name];
  }
  public getExport(name: string): ExportMeta | undefined {
    return this.exports[name];
  }
  //
  // Data allocation, structs, strings, etc.
  //

  // Reserve bytes in the data section, return the start address
  public dataAlloc(size: number, align = 4): number {
    const addr = this.dataPtr;
    const pad = alignup(size, align);
    this.dataPtr += pad;
    return addr;
  }

  // Push an already-encoded byte string at an address; returns addr
  public addBytes(bytes: string, addr?: number, align = 8): number {
    const size = Math.floor(bytes.length / 3); // \xx <-- 3 characters per byte
    const a = addr ?? this.dataAlloc(size, align);
    this.data.push({ bytes, addr: a });
    return a;
  }

  // Intern a raw string's character data and return its pointer
  public internString(lit: string, align = 8): number {
    const hit = this.stringPool[lit];
    if (hit !== undefined) return hit;
    const ptr = this.dataAlloc(lit.length, align);
    this.stringPool[lit] = ptr;
    return ptr;
  }
}
