import { ByteWriter } from "./encode-bytes";
import {
  BLOCKTYPE_VOID,
  EXPORT_KIND,
  FUNCTYPE,
  GLOBAL_CONST,
  GLOBAL_MUT,
  LIMITS_MIN,
  LIMITS_MIN_MAX,
  MAGIC,
  MISC_OPCODES,
  MISC_PREFIX,
  MULTI_CALL_CALLEE_KINDS,
  OPCODES,
  SECTION,
  VALTYPE,
  VERSION,
} from "./encode-constants";
import { binOpcode, exprType, loadOpcode, storeOpcode } from "./expr-info";
import type { ConstExpr, Expr, IrModule, IrType, LabelId, MultiCallCallee, Stmt } from "./ir";

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
}

type CodeContext = {
  localTypes: readonly IrType[];
  labels: Array<LabelId | null>;
};

function memoryAlignment(type: IrType, width: 8 | 16 | undefined): number {
  if (width !== undefined) return Math.log2(width / 8);
  return type === "i64" || type === "f64" ? 3 : 2;
}

function branchDepth(labels: readonly (LabelId | null)[], label: LabelId): number {
  return labels.length - 1 - labels.lastIndexOf(label);
}

function writeMultiCallCallee(
  writer: ByteWriter,
  callee: MultiCallCallee,
  module: IrModule,
  context: CodeContext,
): readonly IrType[] {
  void MULTI_CALL_CALLEE_KINDS[callee.kind];
  switch (callee.kind) {
    case "func": {
      writer.byte(OPCODES.call!);
      writer.u32(callee.fn);
      const sigId =
        callee.fn < module.funcImports.length
          ? module.funcImports[callee.fn]!.sig
          : module.funcs[callee.fn - module.funcImports.length]!.sig;
      return module.types[sigId]!.results;
    }
    case "indirect":
      writeExpr(writer, callee.index, module, context);
      writer.byte(OPCODES.call_indirect!);
      writer.u32(callee.sig);
      writer.byte(0x00);
      return module.types[callee.sig]!.results;
  }
}

function writeExpr(
  writer: ByteWriter,
  expression: Expr,
  module: IrModule,
  context: CodeContext,
): void {
  switch (expression.k) {
    case "const":
      writeConst(writer, expression);
      break;
    case "local.get":
      writer.byte(OPCODES["local.get"]!);
      writer.u32(expression.id);
      break;
    case "global.get":
      writer.byte(OPCODES["global.get"]!);
      writer.u32(expression.id);
      break;
    case "binop":
      writeExpr(writer, expression.l, module, context);
      writeExpr(writer, expression.r, module, context);
      writer.byte(OPCODES[binOpcode(expression.op, expression.type, expression.signed)]!);
      break;
    case "unop":
      writeExpr(writer, expression.e, module, context);
      writer.byte(OPCODES[`${expression.type}.${expression.op}`]!);
      break;
    case "convert":
      writeExpr(writer, expression.e, module, context);
      writer.byte(OPCODES[expression.op]!);
      break;
    case "load":
      writeExpr(writer, expression.addr, module, context);
      writer.byte(OPCODES[loadOpcode(expression.type, expression.width, expression.signed)]!);
      writer.u32(memoryAlignment(expression.type, expression.width));
      writer.u32(expression.offset);
      break;
    case "call":
      for (const arg of expression.args) writeExpr(writer, arg, module, context);
      writer.byte(OPCODES.call!);
      writer.u32(expression.fn);
      break;
    case "call_indirect":
      for (const arg of expression.args) writeExpr(writer, arg, module, context);
      writeExpr(writer, expression.index, module, context);
      writer.byte(OPCODES.call_indirect!);
      writer.u32(expression.sig);
      writer.byte(0x00);
      break;
    case "if_val":
      writeExpr(writer, expression.cond, module, context);
      writer.byte(OPCODES.if!);
      writer.byte(VALTYPE[expression.type]);
      context.labels.push(null);
      writeExpr(writer, expression.then, module, context);
      writer.byte(OPCODES.else!);
      writeExpr(writer, expression.else, module, context);
      writer.byte(OPCODES.end!);
      context.labels.pop();
      break;
    case "seq":
      writer.byte(OPCODES.block!);
      writer.byte(VALTYPE[exprType(module, context.localTypes, expression.value)]);
      context.labels.push(null);
      for (const statement of expression.stmts) writeStmt(writer, statement, module, context);
      writeExpr(writer, expression.value, module, context);
      writer.byte(OPCODES.end!);
      context.labels.pop();
      break;
    case "memory.size":
      writer.byte(OPCODES["memory.size"]!);
      writer.byte(0x00);
      break;
    case "memory.grow":
      writeExpr(writer, expression.pages, module, context);
      writer.byte(OPCODES["memory.grow"]!);
      writer.byte(0x00);
      break;
    default:
      throw new Error(`encode: unknown IR expression kind: ${(expression as { k?: unknown }).k}`);
  }
}

function writeStmt(
  writer: ByteWriter,
  statement: Stmt,
  module: IrModule,
  context: CodeContext,
): void {
  switch (statement.k) {
    case "local.set":
      writeExpr(writer, statement.e, module, context);
      writer.byte(OPCODES["local.set"]!);
      writer.u32(statement.id);
      break;
    case "global.set":
      writeExpr(writer, statement.e, module, context);
      writer.byte(OPCODES["global.set"]!);
      writer.u32(statement.id);
      break;
    case "store":
      writeExpr(writer, statement.addr, module, context);
      writeExpr(writer, statement.value, module, context);
      writer.byte(OPCODES[storeOpcode(statement.type, statement.width)]!);
      writer.u32(memoryAlignment(statement.type, statement.width));
      writer.u32(statement.offset);
      break;
    case "call":
      for (const arg of statement.args) writeExpr(writer, arg, module, context);
      writer.byte(OPCODES.call!);
      writer.u32(statement.fn);
      break;
    case "drop":
      writeExpr(writer, statement.e, module, context);
      writer.byte(OPCODES.drop!);
      break;
    case "multi_call": {
      for (const arg of statement.args) writeExpr(writer, arg, module, context);
      const results = writeMultiCallCallee(writer, statement.callee, module, context);
      if (statement.targets === null) {
        for (const _result of results) writer.byte(OPCODES.drop!);
      } else {
        for (let index = statement.targets.length - 1; index >= 0; index -= 1) {
          writer.byte(OPCODES["local.set"]!);
          writer.u32(statement.targets[index]!);
        }
      }
      break;
    }
    case "call_indirect":
      for (const arg of statement.args) writeExpr(writer, arg, module, context);
      writeExpr(writer, statement.index, module, context);
      writer.byte(OPCODES.call_indirect!);
      writer.u32(statement.sig);
      writer.byte(0x00);
      break;
    case "if":
      writeExpr(writer, statement.cond, module, context);
      writer.byte(OPCODES.if!);
      writer.byte(BLOCKTYPE_VOID);
      context.labels.push(null);
      for (const nested of statement.then) writeStmt(writer, nested, module, context);
      if (statement.else !== undefined) {
        writer.byte(OPCODES.else!);
        for (const nested of statement.else) writeStmt(writer, nested, module, context);
      }
      writer.byte(OPCODES.end!);
      context.labels.pop();
      break;
    case "block":
    case "loop":
      writer.byte(OPCODES[statement.k]!);
      writer.byte(BLOCKTYPE_VOID);
      context.labels.push(statement.label);
      for (const nested of statement.body) writeStmt(writer, nested, module, context);
      writer.byte(OPCODES.end!);
      context.labels.pop();
      break;
    case "br":
      writer.byte(OPCODES.br!);
      writer.u32(branchDepth(context.labels, statement.label));
      break;
    case "br_if":
      writeExpr(writer, statement.cond, module, context);
      writer.byte(OPCODES.br_if!);
      writer.u32(branchDepth(context.labels, statement.label));
      break;
    case "return":
      for (const value of statement.values) writeExpr(writer, value, module, context);
      writer.byte(OPCODES.return!);
      break;
    case "unreachable":
      writer.byte(OPCODES.unreachable!);
      break;
    case "memory.copy":
      writeExpr(writer, statement.dest, module, context);
      writeExpr(writer, statement.src, module, context);
      writeExpr(writer, statement.len, module, context);
      writer.byte(MISC_PREFIX);
      writer.u32(MISC_OPCODES["memory.copy"]);
      writer.byte(0x00);
      writer.byte(0x00);
      break;
    default:
      throw new Error(`encode: unknown IR statement kind: ${(statement as { k?: unknown }).k}`);
  }
}

function writeLocals(writer: ByteWriter, locals: readonly IrType[]): void {
  const runs: Array<{ count: number; type: IrType }> = [];
  for (const type of locals) {
    const prior = runs.at(-1);
    if (prior?.type === type) prior.count += 1;
    else runs.push({ count: 1, type });
  }
  writer.u32(runs.length);
  for (const run of runs) {
    writer.u32(run.count);
    writer.byte(VALTYPE[run.type]);
  }
}

function sortedNameEntries(names: ReadonlyMap<number, string>): Array<[number, string]> {
  return [...names].sort(([left], [right]) => left - right);
}

function writeNameMap(writer: ByteWriter, entries: readonly [number, string][]): void {
  writer.u32(entries.length);
  for (const [index, name] of entries) {
    writer.u32(index);
    writer.name(name);
  }
}

function writeNameSection(writer: ByteWriter, module: IrModule): void {
  const funcs = sortedNameEntries(module.names.funcs);
  const locals = [...module.names.locals]
    .map(([func, names]) => [func, sortedNameEntries(names)] as const)
    .filter((entry) => entry[1].length > 0)
    .sort(([left], [right]) => left - right);
  const globals = sortedNameEntries(module.names.globals);
  if (funcs.length === 0 && locals.length === 0 && globals.length === 0) return;

  writer.section(SECTION.custom, (custom) => {
    custom.name("name");
    if (funcs.length > 0) {
      custom.section(1, (subsection) => writeNameMap(subsection, funcs));
    }
    if (locals.length > 0) {
      custom.section(2, (subsection) => {
        subsection.u32(locals.length);
        for (const [func, names] of locals) {
          subsection.u32(func);
          writeNameMap(subsection, names);
        }
      });
    }
    if (globals.length > 0) {
      custom.section(7, (subsection) => writeNameMap(subsection, globals));
    }
  });
}

export function encodeWasm(module: IrModule, options: { strip?: boolean } = {}): Uint8Array {
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
        section.byte(OPCODES.end!);
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
      for (const fn of module.funcs) {
        section.sized((body) => {
          const sig = module.types[fn.sig]!;
          const context: CodeContext = {
            localTypes: [...sig.params, ...fn.locals],
            labels: [],
          };
          writeLocals(body, fn.locals);
          for (const statement of fn.body) writeStmt(body, statement, module, context);
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

  if (!options.strip) writeNameSection(writer, module);

  return writer.toUint8Array();
}
