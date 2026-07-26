import { ByteWriter } from "./encode-bytes";
import {
  EXPORT_KIND,
  FUNCTYPE,
  GLOBAL_CONST,
  GLOBAL_MUT,
  LIMITS_MIN,
  LIMITS_MIN_MAX,
  MAGIC,
  OPCODES,
  SECTION,
  VALTYPE,
  VERSION,
} from "./encode-constants";
import type { ConstExpr, IrModule } from "./ir";

function writeConst(writer: ByteWriter, expression: ConstExpr): void {
  writer.byte(OPCODES[`${expression.type}.const`]!);
  switch (expression.type) {
    case "i32":
      writer.s32(expression.value as number);
      break;
    case "i64":
      writer.s64(expression.value as bigint);
      break;
    case "f32":
      writer.f32(expression.value as number);
      break;
    case "f64":
      writer.f64(expression.value as number);
      break;
  }
  writer.byte(OPCODES.end!);
}

export function encodeWasm(module: IrModule, options: { strip?: boolean } = {}): Uint8Array {
  void options;
  const writer = new ByteWriter();
  writer.bytes(MAGIC);
  writer.bytes(VERSION);

  if (module.types.length > 0) {
    writer.section(SECTION.type, (section) => {
      section.u32(module.types.length);
      for (const sig of module.types) {
        section.byte(FUNCTYPE);
        section.u32(sig.params.length);
        for (const param of sig.params) section.byte(VALTYPE[param]);
        section.u32(sig.results.length);
        for (const result of sig.results) section.byte(VALTYPE[result]);
      }
    });
  }

  const importCount =
    (module.memory.mode === "imported" ? 1 : 0) +
    module.funcImports.length +
    module.globalImports.length;
  if (importCount > 0) {
    writer.section(SECTION.import, (section) => {
      section.u32(importCount);
      if (module.memory.mode === "imported") {
        section.name("runtime");
        section.name("memory");
        section.byte(EXPORT_KIND.memory);
        section.byte(LIMITS_MIN);
        section.u32(module.memory.initialPages);
      }
      for (const imported of module.funcImports) {
        section.name(imported.module);
        section.name(imported.name);
        section.byte(EXPORT_KIND.func);
        section.u32(imported.sig);
      }
      for (const imported of module.globalImports) {
        section.name(imported.module);
        section.name(imported.name);
        section.byte(EXPORT_KIND.global);
        section.byte(VALTYPE[imported.type]);
        section.byte(GLOBAL_CONST);
      }
    });
  }

  if (module.funcs.length > 0) {
    writer.section(SECTION.function, (section) => {
      section.u32(module.funcs.length);
      for (const fn of module.funcs) section.u32(fn.sig);
    });
  }

  const table = module.table;
  if (table) {
    writer.section(SECTION.table, (section) => {
      const size = table.entries.length;
      section.u32(1);
      section.byte(VALTYPE.funcref);
      section.byte(LIMITS_MIN_MAX);
      section.u32(size);
      section.u32(size);
    });
  }

  switch (module.memory.mode) {
    case "owned":
      writer.section(SECTION.memory, (section) => {
        section.u32(1);
        section.byte(LIMITS_MIN);
        section.u32(module.memory.initialPages);
      });
      break;
    case "imported":
      break;
  }

  if (module.globals.length > 0) {
    writer.section(SECTION.global, (section) => {
      section.u32(module.globals.length);
      for (const global of module.globals) {
        section.byte(VALTYPE[global.type]);
        section.byte(global.mutable ? GLOBAL_MUT : GLOBAL_CONST);
        writeConst(section, global.init);
      }
    });
  }

  const exportedGlobals = module.globals.flatMap((global, index) =>
    global.export === undefined ? [] : [{ name: global.export, index }],
  );
  const exportedFuncs = module.funcs.flatMap((fn, index) =>
    fn.export === undefined ? [] : [{ name: fn.export, index }],
  );
  const exportCount =
    (module.memory.mode === "owned" ? 1 : 0) + exportedGlobals.length + exportedFuncs.length;
  if (exportCount > 0) {
    writer.section(SECTION.export, (section) => {
      section.u32(exportCount);
      if (module.memory.mode === "owned") {
        section.name("memory");
        section.byte(EXPORT_KIND.memory);
        section.u32(0);
      }
      for (const global of exportedGlobals) {
        section.name(global.name);
        section.byte(EXPORT_KIND.global);
        section.u32(module.globalImports.length + global.index);
      }
      for (const fn of exportedFuncs) {
        section.name(fn.name);
        section.byte(EXPORT_KIND.func);
        section.u32(module.funcImports.length + fn.index);
      }
    });
  }

  const start = module.start;
  if (start !== undefined) {
    writer.section(SECTION.start, (section) => {
      section.u32(start);
    });
  }

  const tableEntries = module.table?.entries;
  if (tableEntries && tableEntries.length > 0) {
    writer.section(SECTION.elem, (section) => {
      section.u32(1);
      section.byte(0x00);
      section.byte(OPCODES["i32.const"]!);
      section.s32(0);
      section.byte(OPCODES.end!);
      section.u32(tableEntries.length);
      for (const fn of tableEntries) section.u32(fn);
    });
  }

  if (module.funcs.length > 0) {
    writer.section(SECTION.code, (section) => {
      section.u32(module.funcs.length);
      for (const _fn of module.funcs) {
        section.sized((body) => {
          body.u32(0);
          body.byte(OPCODES.end!);
        });
      }
    });
  }

  if (module.data.length > 0) {
    writer.section(SECTION.data, (section) => {
      section.u32(module.data.length);
      for (const segment of module.data) {
        section.byte(0x00);
        section.byte(OPCODES["i32.const"]!);
        section.s32(segment.addr | 0);
        section.byte(OPCODES.end!);
        section.u32(segment.bytes.byteLength);
        section.bytes(segment.bytes);
      }
    });
  }

  return writer.toUint8Array();
}
