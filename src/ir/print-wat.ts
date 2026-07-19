import type { BinOp, Expr, FuncId, IrModule, IrType, LabelId, LocalId, Sig, Stmt } from "./ir";

const INTEGER_TYPES = new Set<IrType>(["i32", "i64"]);

type FunctionContext = {
  funcId: FuncId;
  localTypes: IrType[];
  labels: Map<LabelId, string>;
  nextLabel: number;
};

function hexByte(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

function quoteWat(value: string): string {
  let escaped = "";
  for (const byte of new TextEncoder().encode(value)) {
    if (byte === 0x22) escaped += '\\"';
    else if (byte === 0x5c) escaped += "\\\\";
    else if (byte < 0x20 || byte === 0x7f || byte >= 0x80) escaped += `\\${hexByte(byte)}`;
    else escaped += String.fromCharCode(byte);
  }
  return `"${escaped}"`;
}

function dataString(bytes: Uint8Array): string {
  return `"${Array.from(bytes, (byte) => `\\${hexByte(byte)}`).join("")}"`;
}

function floatLiteral(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (value === Number.POSITIVE_INFINITY) return "inf";
  if (value === Number.NEGATIVE_INFINITY) return "-inf";
  if (Object.is(value, -0)) return "-0";
  return value.toString();
}

function fold(head: string, operands: string[]): string {
  return operands.length === 0 ? `(${head})` : `(${head} ${operands.join(" ")})`;
}

function resultClause(results: IrType[]): string {
  return results.length === 0 ? "" : ` (result ${results.join(" ")})`;
}

function signatureBody(sig: Sig): string {
  const params = sig.params.length === 0 ? "" : ` (param ${sig.params.join(" ")})`;
  return `(func${params}${resultClause(sig.results)})`;
}

class WatPrinter {
  constructor(private readonly module: IrModule) {}

  print(): string {
    const lines = ["(module"];
    this.printImports(lines);
    if (this.module.memory.mode === "owned") {
      lines.push(`  (memory (export "memory") ${this.module.memory.initialPages})`);
    }
    this.printTable(lines);
    this.printGlobals(lines);
    this.printTypes(lines);
    this.printFunctions(lines);
    this.printElem(lines);
    this.printData(lines);
    if (this.module.start !== undefined) {
      lines.push(`  (start ${this.funcName(this.module.start)})`);
    }
    lines.push(")");
    return lines.join("\n");
  }

  private printImports(lines: string[]): void {
    if (this.module.memory.mode === "imported") {
      lines.push(`  (import "runtime" "memory" (memory ${this.module.memory.initialPages}))`);
    }
    for (let id = 0; id < this.module.funcImports.length; id += 1) {
      const imported = this.module.funcImports[id]!;
      const sig = this.sig(imported.sig);
      const params = sig.params.length === 0 ? "" : ` (param ${sig.params.join(" ")})`;
      lines.push(
        `  (import ${quoteWat(imported.module)} ${quoteWat(imported.name)} (func ${this.funcName(id)}${params}${resultClause(sig.results)}))`,
      );
    }
    for (let id = 0; id < this.module.globalImports.length; id += 1) {
      const imported = this.module.globalImports[id]!;
      lines.push(
        `  (import ${quoteWat(imported.module)} ${quoteWat(imported.name)} (global ${this.globalName(id)} ${imported.type}))`,
      );
    }
  }

  private printTable(lines: string[]): void {
    if (!this.module.table) return;
    const size = this.module.table.entries.length;
    lines.push(`  (table $__fn_table ${size} ${size} funcref)`);
  }

  private printGlobals(lines: string[]): void {
    const firstId = this.module.globalImports.length;
    for (let index = 0; index < this.module.globals.length; index += 1) {
      const global = this.module.globals[index]!;
      const id = firstId + index;
      const exported = global.export === undefined ? "" : ` (export ${quoteWat(global.export)})`;
      const type = global.mutable ? `(mut ${global.type})` : global.type;
      lines.push(
        `  (global ${this.globalName(id)}${exported} ${type} ${this.printConst(global.init)})`,
      );
    }
  }

  private printTypes(lines: string[]): void {
    for (let id = 0; id < this.module.types.length; id += 1) {
      lines.push(`  (type $t${id} ${signatureBody(this.module.types[id]!)})`);
    }
  }

  private printFunctions(lines: string[]): void {
    const firstId = this.module.funcImports.length;
    for (let index = 0; index < this.module.funcs.length; index += 1) {
      const fn = this.module.funcs[index]!;
      const funcId = firstId + index;
      const sig = this.sig(fn.sig);
      const exported = fn.export === undefined ? "" : ` (export ${quoteWat(fn.export)})`;
      const params = sig.params
        .map((type, id) => ` (param ${this.localName(funcId, id)} ${type})`)
        .join("");
      lines.push(
        `  (func ${this.funcName(funcId)}${exported} (type $t${fn.sig})${params}${resultClause(sig.results)}`,
      );
      const context: FunctionContext = {
        funcId,
        localTypes: [...sig.params, ...fn.locals],
        labels: new Map(),
        nextLabel: 0,
      };
      for (let index = 0; index < fn.locals.length; index += 1) {
        const id = sig.params.length + index;
        lines.push(`    (local ${this.localName(funcId, id)} ${fn.locals[index]})`);
      }
      for (const statement of fn.body) {
        for (const printed of this.printStmt(statement, context)) lines.push(`    ${printed}`);
      }
      lines.push("  )");
    }
  }

  private printElem(lines: string[]): void {
    if (!this.module.table || this.module.table.entries.length === 0) return;
    const entries = this.module.table.entries.map((id) => this.funcName(id));
    lines.push(`  (elem (i32.const 0) func ${entries.join(" ")})`);
  }

  private printData(lines: string[]): void {
    for (const segment of this.module.data) {
      lines.push(`  (data (offset (i32.const ${segment.addr})) ${dataString(segment.bytes)})`);
    }
  }

  private printStmt(statement: Stmt, context: FunctionContext): string[] {
    switch (statement.k) {
      case "local.set":
        return [
          fold(`local.set ${this.localName(context.funcId, statement.id)}`, [
            this.printExpr(statement.e, context),
          ]),
        ];
      case "global.set":
        return [
          fold(`global.set ${this.globalName(statement.id)}`, [
            this.printExpr(statement.e, context),
          ]),
        ];
      case "store":
        return [
          fold(`${this.storeOpcode(statement.type, statement.width)} offset=${statement.offset}`, [
            this.printExpr(statement.addr, context),
            this.printExpr(statement.value, context),
          ]),
        ];
      case "call":
        return [this.printDirectCall(statement.fn, statement.args, context)];
      case "drop":
        return [fold("drop", [this.printExpr(statement.e, context)])];
      case "multi_call":
        return this.printMultiCall(statement, context);
      case "call_indirect":
        return [this.printIndirectCall(statement.sig, statement.index, statement.args, context)];
      case "if": {
        const thenBody = this.printStatementsInline(statement.then, context);
        const thenArm = fold("then", thenBody);
        const operands = [this.printExpr(statement.cond, context), thenArm];
        if (statement.else !== undefined) {
          operands.push(fold("else", this.printStatementsInline(statement.else, context)));
        }
        return [fold("if", operands)];
      }
      case "block":
      case "loop": {
        const name = `$L${context.nextLabel}`;
        context.nextLabel += 1;
        context.labels.set(statement.label, name);
        const body = this.printStatementsInline(statement.body, context);
        context.labels.delete(statement.label);
        return [fold(`${statement.k} ${name}`, body)];
      }
      case "br":
        return [fold(`br ${this.labelName(statement.label, context)}`, [])];
      case "br_if":
        return [
          fold(`br_if ${this.labelName(statement.label, context)}`, [
            this.printExpr(statement.cond, context),
          ]),
        ];
      case "return":
        return [
          fold(
            "return",
            statement.values.map((value) => this.printExpr(value, context)),
          ),
        ];
      case "unreachable":
        return ["(unreachable)"];
      case "memory.copy":
        return [
          fold("memory.copy", [
            this.printExpr(statement.dest, context),
            this.printExpr(statement.src, context),
            this.printExpr(statement.len, context),
          ]),
        ];
      default:
        return this.unknownStatement(statement);
    }
  }

  private printStatementsInline(statements: Stmt[], context: FunctionContext): string[] {
    return statements.flatMap((statement) => this.printStmt(statement, context));
  }

  private printMultiCall(
    statement: Extract<Stmt, { k: "multi_call" }>,
    context: FunctionContext,
  ): string[] {
    let call: string;
    let sig: Sig;
    if (statement.callee.kind === "func") {
      call = this.printDirectCall(statement.callee.fn, statement.args, context);
      sig = this.funcSig(statement.callee.fn);
    } else {
      call = this.printIndirectCall(
        statement.callee.sig,
        statement.callee.index,
        statement.args,
        context,
      );
      sig = this.sig(statement.callee.sig);
    }
    const output = [call];
    if (statement.targets === null) {
      for (let index = 0; index < sig.results.length; index += 1) output.push("(drop)");
      return output;
    }
    for (let index = statement.targets.length - 1; index >= 0; index -= 1) {
      output.push(`(local.set ${this.localName(context.funcId, statement.targets[index]!)})`);
    }
    return output;
  }

  private printExpr(expression: Expr, context: FunctionContext): string {
    switch (expression.k) {
      case "const":
        return this.printConst(expression);
      case "local.get":
        return fold(`local.get ${this.localName(context.funcId, expression.id)}`, []);
      case "global.get":
        return fold(`global.get ${this.globalName(expression.id)}`, []);
      case "binop":
        return fold(this.binOpcode(expression.op, expression.type, expression.signed), [
          this.printExpr(expression.l, context),
          this.printExpr(expression.r, context),
        ]);
      case "unop":
        return fold(`${expression.type}.${expression.op}`, [this.printExpr(expression.e, context)]);
      case "convert":
        return fold(expression.op, [this.printExpr(expression.e, context)]);
      case "load":
        return fold(
          `${this.loadOpcode(expression.type, expression.width, expression.signed)} offset=${expression.offset}`,
          [this.printExpr(expression.addr, context)],
        );
      case "call":
        return this.printDirectCall(expression.fn, expression.args, context);
      case "call_indirect":
        return this.printIndirectCall(expression.sig, expression.index, expression.args, context);
      case "if_val":
        return fold(`if (result ${expression.type})`, [
          this.printExpr(expression.cond, context),
          fold("then", [this.printExpr(expression.then, context)]),
          fold("else", [this.printExpr(expression.else, context)]),
        ]);
      case "seq": {
        const type = this.exprType(expression.value, context);
        return fold(`block (result ${type})`, [
          ...this.printStatementsInline(expression.stmts, context),
          this.printExpr(expression.value, context),
        ]);
      }
      case "memory.size":
        return "(memory.size)";
      case "memory.grow":
        return fold("memory.grow", [this.printExpr(expression.pages, context)]);
      default:
        return this.unknownExpression(expression);
    }
  }

  private printConst(expression: Extract<Expr, { k: "const" }>): string {
    const value =
      expression.type === "f32" || expression.type === "f64"
        ? floatLiteral(expression.value as number)
        : expression.value.toString();
    return `(${expression.type}.const ${value})`;
  }

  private printDirectCall(fn: FuncId, args: Expr[], context: FunctionContext): string {
    return fold(
      `call ${this.funcName(fn)}`,
      args.map((arg) => this.printExpr(arg, context)),
    );
  }

  private printIndirectCall(
    sig: number,
    index: Expr,
    args: Expr[],
    context: FunctionContext,
  ): string {
    return fold(`call_indirect (type $t${sig})`, [
      ...args.map((arg) => this.printExpr(arg, context)),
      this.printExpr(index, context),
    ]);
  }

  private binOpcode(op: BinOp, type: IrType, signed: boolean): string {
    switch (op) {
      case "div":
      case "rem":
        return INTEGER_TYPES.has(type) ? `${type}.${op}_${signed ? "s" : "u"}` : `${type}.${op}`;
      case "shr":
        return `${type}.shr_${signed ? "s" : "u"}`;
      case "lt":
      case "le":
      case "gt":
      case "ge":
        return INTEGER_TYPES.has(type) ? `${type}.${op}_${signed ? "s" : "u"}` : `${type}.${op}`;
      case "add":
      case "sub":
      case "mul":
      case "and":
      case "or":
      case "xor":
      case "shl":
      case "eq":
      case "ne":
      case "copysign":
        return `${type}.${op}`;
      default:
        return this.unknownBinop(op);
    }
  }

  private loadOpcode(type: IrType, width: 8 | 16 | undefined, signed: boolean | undefined): string {
    return width === undefined ? `${type}.load` : `${type}.load${width}_${signed ? "s" : "u"}`;
  }

  private storeOpcode(type: IrType, width: 8 | 16 | undefined): string {
    return width === undefined ? `${type}.store` : `${type}.store${width}`;
  }

  private exprType(expression: Expr, context: FunctionContext): IrType {
    switch (expression.k) {
      case "const":
      case "binop":
      case "unop":
      case "load":
      case "if_val":
        if (
          (expression.k === "binop" &&
            ["eq", "ne", "lt", "le", "gt", "ge"].includes(expression.op)) ||
          (expression.k === "unop" && expression.op === "eqz")
        ) {
          return "i32";
        }
        return expression.type;
      case "local.get":
        return context.localTypes[expression.id]!;
      case "global.get":
        return this.globalType(expression.id);
      case "convert": {
        const result = expression.op.slice(0, 3);
        if (result === "i32" || result === "i64" || result === "f32" || result === "f64") {
          return result;
        }
        throw new Error(`unknown IR conversion: ${expression.op}`);
      }
      case "call":
        return this.funcSig(expression.fn).results[0]!;
      case "call_indirect":
        return this.sig(expression.sig).results[0]!;
      case "seq":
        return this.exprType(expression.value, context);
      case "memory.size":
      case "memory.grow":
        return "i32";
      default:
        return this.unknownExpression(expression);
    }
  }

  private sig(id: number): Sig {
    const sig = this.module.types[id];
    if (!sig) throw new Error(`unknown IR signature id: ${id}`);
    return sig;
  }

  private funcSig(id: FuncId): Sig {
    const sigId =
      id < this.module.funcImports.length
        ? this.module.funcImports[id]?.sig
        : this.module.funcs[id - this.module.funcImports.length]?.sig;
    if (sigId === undefined) throw new Error(`unknown IR function id: ${id}`);
    return this.sig(sigId);
  }

  private globalType(id: number): IrType {
    if (id < this.module.globalImports.length) {
      const imported = this.module.globalImports[id];
      if (imported) return imported.type;
    }
    const global = this.module.globals[id - this.module.globalImports.length];
    if (!global) throw new Error(`unknown IR global id: ${id}`);
    return global.type;
  }

  private funcName(id: FuncId): string {
    const name = this.module.names.funcs.get(id);
    return name === undefined ? `$f${id}` : `$${name}_${id}`;
  }

  private globalName(id: number): string {
    const name = this.module.names.globals.get(id);
    return name === undefined ? `$g${id}` : `$${name}_${id}`;
  }

  private localName(funcId: FuncId, id: LocalId): string {
    const name = this.module.names.locals.get(funcId)?.get(id);
    return name === undefined ? `$l${id}` : `$${name}_${id}`;
  }

  private labelName(id: LabelId, context: FunctionContext): string {
    const name = context.labels.get(id);
    if (!name) throw new Error(`unknown IR label id: ${id}`);
    return name;
  }

  private unknownExpression(expression: never): never {
    throw new Error(`unknown IR expression kind: ${(expression as { k?: unknown }).k}`);
  }

  private unknownStatement(statement: never): never {
    throw new Error(`unknown IR statement kind: ${(statement as { k?: unknown }).k}`);
  }

  private unknownBinop(op: never): never {
    throw new Error(`unknown IR binop: ${op}`);
  }
}

export function printWat(module: IrModule): string {
  return new WatPrinter(module).print();
}
