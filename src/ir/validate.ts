import type {
  ConvOp,
  Expr,
  FuncId,
  IrModule,
  IrType,
  LabelId,
  LocalId,
  Sig,
  Stmt,
  StructLayoutMember,
} from "./ir";

const INTEGER_TYPES = new Set<IrType>(["i32", "i64"]);
const FLOAT_TYPES = new Set<IrType>(["f32", "f64"]);
const COMPARISON_OPS = new Set(["eq", "ne", "lt", "le", "gt", "ge"]);
const INTEGER_BINOPS = new Set(["rem", "and", "or", "xor", "shl", "shr"]);
const FLOAT_UNOPS = new Set(["neg", "abs", "sqrt", "floor", "ceil", "trunc", "nearest"]);
const U32_MAX = 0xffff_ffff;
const WASM_PAGE_SIZE = 65_536;
const WAT_SAFE_NAME = /^[0-9A-Za-z!#$%&'*+\-./:<=>?@\\^_`|~]*$/;

const CONVERSIONS: Record<ConvOp, { source: IrType; result: IrType }> = {
  "i32.wrap_i64": { source: "i64", result: "i32" },
  "i64.extend_i32_s": { source: "i32", result: "i64" },
  "i64.extend_i32_u": { source: "i32", result: "i64" },
  "i32.trunc_f32_s": { source: "f32", result: "i32" },
  "i32.trunc_f32_u": { source: "f32", result: "i32" },
  "i32.trunc_f64_s": { source: "f64", result: "i32" },
  "i32.trunc_f64_u": { source: "f64", result: "i32" },
  "i64.trunc_f32_s": { source: "f32", result: "i64" },
  "i64.trunc_f32_u": { source: "f32", result: "i64" },
  "i64.trunc_f64_s": { source: "f64", result: "i64" },
  "i64.trunc_f64_u": { source: "f64", result: "i64" },
  "f32.convert_i32_s": { source: "i32", result: "f32" },
  "f32.convert_i32_u": { source: "i32", result: "f32" },
  "f32.convert_i64_s": { source: "i64", result: "f32" },
  "f32.convert_i64_u": { source: "i64", result: "f32" },
  "f64.convert_i32_s": { source: "i32", result: "f64" },
  "f64.convert_i32_u": { source: "i32", result: "f64" },
  "f64.convert_i64_s": { source: "i64", result: "f64" },
  "f64.convert_i64_u": { source: "i64", result: "f64" },
  "f32.demote_f64": { source: "f64", result: "f32" },
  "f64.promote_f32": { source: "f32", result: "f64" },
  "i32.extend8_s": { source: "i32", result: "i32" },
  "i32.extend16_s": { source: "i32", result: "i32" },
  "i64.extend8_s": { source: "i64", result: "i64" },
  "i64.extend16_s": { source: "i64", result: "i64" },
  "i64.extend32_s": { source: "i64", result: "i64" },
};

type FunctionContext = {
  localTypes: IrType[];
  results: IrType[];
  labels: LabelId[];
  seenLabels: Set<LabelId>;
};

type GlobalInfo = {
  type: IrType;
  mutable: boolean;
};

class Validator {
  private readonly errors: string[] = [];

  constructor(private readonly module: IrModule) {}

  validate(): string[] {
    this.validateSignatures();
    this.validateFunctions();
    this.validateGlobals();
    this.validateTable();
    this.validateStart();
    this.validateExports();
    this.validateMemoryAndData();
    this.validateStructLayouts();
    this.validateNames();
    return this.errors;
  }

  private add(message: string): void {
    this.errors.push(message);
  }

  private validIndex(id: number, length: number): boolean {
    return Number.isInteger(id) && id >= 0 && id < length;
  }

  private getSig(id: number): Sig | undefined {
    if (!this.validIndex(id, this.module.types.length)) {
      this.add(`signature id ${id} is out of range`);
      return undefined;
    }
    return this.module.types[id];
  }

  private getFuncSig(id: FuncId): Sig | undefined {
    const count = this.module.funcImports.length + this.module.funcs.length;
    if (!this.validIndex(id, count)) {
      this.add(`function id ${id} is out of range`);
      return undefined;
    }
    const sigId =
      id < this.module.funcImports.length
        ? this.module.funcImports[id]!.sig
        : this.module.funcs[id - this.module.funcImports.length]!.sig;
    return this.getSig(sigId);
  }

  private getGlobal(id: number): GlobalInfo | undefined {
    const count = this.module.globalImports.length + this.module.globals.length;
    if (!this.validIndex(id, count)) {
      this.add(`global id ${id} is out of range`);
      return undefined;
    }
    if (id < this.module.globalImports.length) {
      return { type: this.module.globalImports[id]!.type, mutable: false };
    }
    return this.module.globals[id - this.module.globalImports.length];
  }

  private getLocalType(id: LocalId, context: FunctionContext): IrType | undefined {
    if (!this.validIndex(id, context.localTypes.length)) {
      this.add(`local id ${id} is out of range`);
      return undefined;
    }
    return context.localTypes[id];
  }

  private validateSignatures(): void {
    const shapes = new Map<string, number>();
    for (let index = 0; index < this.module.types.length; index += 1) {
      const sig = this.module.types[index]!;
      const shape = `${sig.params.join(",")}->${sig.results.join(",")}`;
      const prior = shapes.get(shape);
      if (prior !== undefined) this.add(`signature ${index} duplicates signature ${prior}`);
      else shapes.set(shape, index);
    }
    for (const imported of this.module.funcImports) this.getSig(imported.sig);
  }

  private validateFunctions(): void {
    for (const fn of this.module.funcs) {
      const sig = this.getSig(fn.sig);
      const context: FunctionContext = {
        localTypes: [...(sig?.params ?? []), ...fn.locals],
        results: sig?.results ?? [],
        labels: [],
        seenLabels: new Set(),
      };
      this.validateStatements(fn.body, context, 0);
      if (sig && sig.results.length > 0 && !this.statementsTerminate(fn.body)) {
        this.add("function with results must end in a terminating statement");
      }
    }
  }

  private validateGlobals(): void {
    for (const global of this.module.globals) {
      const init = global.init as unknown as Expr;
      if (init.k !== "const") {
        this.add("global initializer must be a const expression");
        continue;
      }
      const actual = this.validateConst(init);
      if (actual !== global.type) {
        this.add(`global initializer must have type ${global.type}, got ${actual}`);
      }
    }
  }

  private validateTable(): void {
    if (!this.module.table) return;
    for (const fn of this.module.table.entries) this.getFuncSig(fn);
  }

  private validateStart(): void {
    if (this.module.start === undefined) return;
    const sig = this.getFuncSig(this.module.start);
    if (sig && (sig.params.length !== 0 || sig.results.length !== 0)) {
      this.add("start function must have signature [] -> []");
    }
  }

  private validateExports(): void {
    const exports = new Set<string>();
    const addExport = (name: string | undefined): void => {
      if (name === undefined) return;
      if (exports.has(name)) this.add(`export name ${JSON.stringify(name)} is duplicated`);
      else exports.add(name);
    };
    for (const fn of this.module.funcs) addExport(fn.export);
    for (const global of this.module.globals) addExport(global.export);
    if (this.module.memory.mode === "owned") addExport("memory");
  }

  private validateMemoryAndData(): void {
    const pages = this.module.memory.initialPages;
    if (!Number.isInteger(pages)) this.add("memory initialPages must be an integer");
    if (pages < 1) this.add("memory initialPages must be at least 1");
    if (pages > 65_536) this.add("memory initialPages must not exceed 65536");
    const memoryBytes = pages * WASM_PAGE_SIZE;

    const validSegments: Array<{ addr: number; end: number }> = [];
    let greatestEnd = 0;
    for (const segment of this.module.data) {
      if (!Number.isInteger(segment.addr) || segment.addr < 0) {
        this.add("data segment address must be a non-negative integer");
        continue;
      }
      if (segment.addr > U32_MAX) {
        this.add(`data segment addr out of u32 range: ${segment.addr}`);
      }
      const end = segment.addr + segment.bytes.byteLength;
      validSegments.push({ addr: segment.addr, end });
      greatestEnd = Math.max(greatestEnd, end);
      if (end > memoryBytes) this.add("data segment exceeds initial memory");
    }
    validSegments.sort((left, right) => left.addr - right.addr);
    for (let index = 1; index < validSegments.length; index += 1) {
      if (validSegments[index - 1]!.end > validSegments[index]!.addr) {
        this.add("data segments overlap");
      }
    }

    if (!Number.isInteger(this.module.dataEnd)) this.add("dataEnd must be an integer");
    if (this.module.dataEnd < WASM_PAGE_SIZE) this.add("dataEnd must be at least 65536");
    if (this.module.dataEnd < greatestEnd) this.add("dataEnd must cover every data segment");
    if (this.module.dataEnd > memoryBytes) this.add("dataEnd exceeds initial memory");
  }

  private validateStructLayouts(): void {
    for (const [identity, layout] of this.module.structLayouts) {
      if (!Number.isInteger(layout.size) || layout.size < 0) {
        this.add(`struct ${identity} size must be a non-negative integer`);
      }
      if (
        !Number.isInteger(layout.align) ||
        layout.align <= 0 ||
        !Number.isInteger(Math.log2(layout.align))
      ) {
        this.add(`struct ${identity} alignment must be a positive power of two`);
      }

      let priorOffset = -1;
      let priorEnd = 0;
      for (const member of layout.members) {
        const validOffset = Number.isInteger(member.offset) && member.offset >= 0;
        if (!validOffset) {
          this.add(
            `struct ${identity} member ${member.name} offset must be a non-negative integer`,
          );
        }
        if (member.offset < priorOffset) {
          this.add(`struct ${identity} members must be ordered by offset`);
        }
        if (validOffset && member.offset < priorEnd) {
          this.add(`struct ${identity} members overlap`);
        }
        const size = this.memberSize(member, identity);
        const end = member.offset + size;
        if (validOffset && end > layout.size) {
          this.add(`struct ${identity} member ${member.name} exceeds struct size`);
        }
        priorOffset = member.offset;
        if (validOffset) priorEnd = Math.max(priorEnd, end);
      }
    }
  }

  private memberSize(member: StructLayoutMember, identity: string): number {
    if (member.width !== undefined) {
      if (member.width !== 8 && member.width !== 16) {
        this.add(`struct ${identity} member ${member.name} width must be 8 or 16`);
      }
      if (!INTEGER_TYPES.has(member.lane)) {
        this.add(`struct ${identity} member ${member.name} width requires an integer lane`);
      }
      return member.width / 8;
    }
    return member.lane === "i64" || member.lane === "f64" ? 8 : 4;
  }

  private validateNames(): void {
    const functionCount = this.module.funcImports.length + this.module.funcs.length;
    const globalCount = this.module.globalImports.length + this.module.globals.length;
    for (const [id, name] of this.module.names.funcs) {
      if (!this.validIndex(id, functionCount)) this.add(`function id ${id} is out of range`);
      this.validateName(name);
    }
    for (const [id, name] of this.module.names.globals) {
      if (!this.validIndex(id, globalCount)) this.add(`global id ${id} is out of range`);
      this.validateName(name);
    }
    for (const [fnId, locals] of this.module.names.locals) {
      for (const name of locals.values()) this.validateName(name);
      const sig = this.getFuncSig(fnId);
      if (!sig) continue;
      const definedIndex = fnId - this.module.funcImports.length;
      const declared = definedIndex >= 0 ? (this.module.funcs[definedIndex]?.locals ?? []) : [];
      const context: FunctionContext = {
        localTypes: [...sig.params, ...declared],
        results: sig.results,
        labels: [],
        seenLabels: new Set(),
      };
      for (const localId of locals.keys()) this.getLocalType(localId, context);
    }
  }

  private validateName(name: string): void {
    if (!WAT_SAFE_NAME.test(name)) this.add(`name not WAT-safe: ${name}`);
  }

  private validateStatements(
    statements: Stmt[],
    context: FunctionContext,
    branchFloor: number,
  ): void {
    for (const statement of statements) this.validateStatement(statement, context, branchFloor);
  }

  private validateStatement(statement: Stmt, context: FunctionContext, branchFloor: number): void {
    switch (statement.k) {
      case "local.set": {
        const expected = this.getLocalType(statement.id, context);
        const actual = this.validateExpr(statement.e, context, branchFloor);
        this.expectType(actual, expected, "local.set value");
        return;
      }
      case "global.set": {
        const global = this.getGlobal(statement.id);
        const actual = this.validateExpr(statement.e, context, branchFloor);
        if (global && !global.mutable) this.add(`global id ${statement.id} is immutable`);
        this.expectType(actual, global?.type, "global.set value");
        return;
      }
      case "store": {
        this.validateWidth("store", statement.type, statement.width);
        this.validateOffset("store", statement.offset);
        const address = this.validateExpr(statement.addr, context, branchFloor);
        const value = this.validateExpr(statement.value, context, branchFloor);
        this.expectType(address, "i32", "store address");
        this.expectType(value, statement.type, "store value");
        return;
      }
      case "call": {
        const sig = this.getFuncSig(statement.fn);
        this.validateCallArgs(statement.args, sig, "call", context, branchFloor);
        if (sig && sig.results.length !== 0) this.add("statement call must have zero results");
        return;
      }
      case "drop":
        this.validateExpr(statement.e, context, branchFloor);
        return;
      case "multi_call":
        this.validateMultiCall(statement, context, branchFloor);
        return;
      case "call_indirect": {
        this.requireTable();
        const index = this.validateExpr(statement.index, context, branchFloor);
        this.expectType(index, "i32", "indirect call index");
        const sig = this.getSig(statement.sig);
        this.validateCallArgs(statement.args, sig, "call_indirect", context, branchFloor);
        if (sig && sig.results.length !== 0) {
          this.add("statement call_indirect must have zero results");
        }
        return;
      }
      case "if": {
        const condition = this.validateExpr(statement.cond, context, branchFloor);
        this.expectType(condition, "i32", "if condition");
        this.validateStatements(statement.then, context, branchFloor);
        if (statement.else) this.validateStatements(statement.else, context, branchFloor);
        return;
      }
      case "block":
      case "loop":
        this.validateLabeledStatement(statement, context, branchFloor);
        return;
      case "br":
        this.validateBranch(statement.label, context, branchFloor);
        return;
      case "br_if": {
        this.validateBranch(statement.label, context, branchFloor);
        const condition = this.validateExpr(statement.cond, context, branchFloor);
        this.expectType(condition, "i32", "br_if condition");
        return;
      }
      case "return": {
        const actual = statement.values.map((value) =>
          this.validateExpr(value, context, branchFloor),
        );
        if (actual.length !== context.results.length) {
          this.add("return value count must match function results");
        }
        const count = Math.min(actual.length, context.results.length);
        for (let index = 0; index < count; index += 1) {
          this.expectType(actual[index], context.results[index], `return value ${index}`);
        }
        return;
      }
      case "unreachable":
        return;
      case "memory.copy": {
        const dest = this.validateExpr(statement.dest, context, branchFloor);
        const src = this.validateExpr(statement.src, context, branchFloor);
        const len = this.validateExpr(statement.len, context, branchFloor);
        this.expectType(dest, "i32", "memory.copy dest");
        this.expectType(src, "i32", "memory.copy src");
        this.expectType(len, "i32", "memory.copy len");
        return;
      }
      default:
        this.unknownStatement(statement);
    }
  }

  private validateLabeledStatement(
    statement: Extract<Stmt, { k: "block" | "loop" }>,
    context: FunctionContext,
    branchFloor: number,
  ): void {
    if (!Number.isInteger(statement.label) || statement.label < 0) {
      this.add(`label id ${statement.label} must be a non-negative integer`);
    }
    if (context.seenLabels.has(statement.label)) {
      this.add(`label id ${statement.label} is duplicated`);
    } else {
      context.seenLabels.add(statement.label);
    }
    context.labels.push(statement.label);
    this.validateStatements(statement.body, context, branchFloor);
    context.labels.pop();
  }

  private validateBranch(label: LabelId, context: FunctionContext, branchFloor: number): void {
    const index = context.labels.lastIndexOf(label);
    if (index < 0) this.add(`branch target label ${label} is not enclosing`);
    else if (index < branchFloor) this.add(`branch target label ${label} escapes seq`);
  }

  private validateMultiCall(
    statement: Extract<Stmt, { k: "multi_call" }>,
    context: FunctionContext,
    branchFloor: number,
  ): void {
    let sig: Sig | undefined;
    if (statement.callee.kind === "func") {
      sig = this.getFuncSig(statement.callee.fn);
    } else {
      this.requireTable();
      const index = this.validateExpr(statement.callee.index, context, branchFloor);
      this.expectType(index, "i32", "indirect call index");
      sig = this.getSig(statement.callee.sig);
    }
    this.validateCallArgs(statement.args, sig, "multi_call", context, branchFloor);
    if (sig && sig.results.length < 2) this.add("multi_call must have multiple results");

    if (statement.targets === null) return;
    const targetTypes = statement.targets.map((target) => this.getLocalType(target, context));
    if (sig && statement.targets.length !== sig.results.length) {
      this.add("multi_call target count must match result count");
    }
    if (!sig) return;
    const count = Math.min(targetTypes.length, sig.results.length);
    for (let index = 0; index < count; index += 1) {
      this.expectType(targetTypes[index], sig.results[index], `multi_call target ${index}`);
    }
  }

  private statementsTerminate(statements: Stmt[]): boolean {
    const last = statements.at(-1);
    return last?.k === "return" || last?.k === "unreachable";
  }

  private validateExpr(
    expression: Expr,
    context: FunctionContext,
    branchFloor: number,
  ): IrType | undefined {
    switch (expression.k) {
      case "const":
        return this.validateConst(expression);
      case "local.get":
        return this.getLocalType(expression.id, context);
      case "global.get":
        return this.getGlobal(expression.id)?.type;
      case "binop": {
        const left = this.validateExpr(expression.l, context, branchFloor);
        const right = this.validateExpr(expression.r, context, branchFloor);
        this.expectType(left, expression.type, `binop ${expression.op} left operand`);
        this.expectType(right, expression.type, `binop ${expression.op} right operand`);
        if (INTEGER_BINOPS.has(expression.op) && !INTEGER_TYPES.has(expression.type)) {
          this.add(`binop ${expression.op} requires an integer lane`);
        }
        if (expression.op === "copysign" && !FLOAT_TYPES.has(expression.type)) {
          this.add("binop copysign requires a float lane");
        }
        return COMPARISON_OPS.has(expression.op) ? "i32" : expression.type;
      }
      case "unop": {
        const operand = this.validateExpr(expression.e, context, branchFloor);
        this.expectType(operand, expression.type, `unop ${expression.op} operand`);
        if (expression.op === "eqz" && !INTEGER_TYPES.has(expression.type)) {
          this.add("unop eqz requires an integer lane");
        }
        if (FLOAT_UNOPS.has(expression.op) && !FLOAT_TYPES.has(expression.type)) {
          this.add(`unop ${expression.op} requires a float lane`);
        }
        return expression.op === "eqz" ? "i32" : expression.type;
      }
      case "convert": {
        const conversion = CONVERSIONS[expression.op];
        const operand = this.validateExpr(expression.e, context, branchFloor);
        this.expectType(operand, conversion.source, `convert ${expression.op} operand`);
        return conversion.result;
      }
      case "load": {
        this.validateWidth("load", expression.type, expression.width);
        const hasWidth = Object.hasOwn(expression, "width");
        const hasSigned = Object.hasOwn(expression, "signed");
        if (hasWidth && !hasSigned) this.add("narrow load requires signed");
        if (!hasWidth && hasSigned) this.add("full-width load must not specify signed");
        if (hasSigned && typeof expression.signed !== "boolean") {
          this.add("load signed must be boolean");
        }
        const address = this.validateExpr(expression.addr, context, branchFloor);
        this.expectType(address, "i32", "load address");
        this.validateOffset("load", expression.offset);
        return expression.type;
      }
      case "call": {
        const sig = this.getFuncSig(expression.fn);
        this.validateCallArgs(expression.args, sig, "call", context, branchFloor);
        if (!sig) return undefined;
        if (sig.results.length !== 1) {
          this.add("expression call must have exactly one result");
          return undefined;
        }
        return sig.results[0];
      }
      case "call_indirect": {
        this.requireTable();
        const index = this.validateExpr(expression.index, context, branchFloor);
        this.expectType(index, "i32", "indirect call index");
        const sig = this.getSig(expression.sig);
        this.validateCallArgs(expression.args, sig, "call_indirect", context, branchFloor);
        if (!sig) return undefined;
        if (sig.results.length !== 1) {
          this.add("expression call_indirect must have exactly one result");
          return undefined;
        }
        return sig.results[0];
      }
      case "if_val": {
        const condition = this.validateExpr(expression.cond, context, branchFloor);
        const thenType = this.validateExpr(expression.then, context, branchFloor);
        const elseType = this.validateExpr(expression.else, context, branchFloor);
        this.expectType(condition, "i32", "if_val condition");
        this.expectType(thenType, expression.type, "if_val then arm");
        this.expectType(elseType, expression.type, "if_val else arm");
        return expression.type;
      }
      case "seq": {
        const seqFloor = context.labels.length;
        this.validateStatements(expression.stmts, context, seqFloor);
        return this.validateExpr(expression.value, context, branchFloor);
      }
      case "memory.size":
        return "i32";
      case "memory.grow": {
        const pages = this.validateExpr(expression.pages, context, branchFloor);
        this.expectType(pages, "i32", "memory.grow pages");
        return "i32";
      }
      default:
        this.unknownExpression(expression);
        return undefined;
    }
  }

  private validateCallArgs(
    args: Expr[],
    sig: Sig | undefined,
    callKind: "call" | "call_indirect" | "multi_call",
    context: FunctionContext,
    branchFloor: number,
  ): void {
    const actual = args.map((arg) => this.validateExpr(arg, context, branchFloor));
    if (!sig) return;
    if (args.length !== sig.params.length) {
      this.add(`${callKind} argument count must match signature`);
    }
    const count = Math.min(args.length, sig.params.length);
    for (let index = 0; index < count; index += 1) {
      this.expectType(actual[index], sig.params[index], `${callKind} argument ${index}`);
    }
  }

  private validateConst(expression: Extract<Expr, { k: "const" }>): IrType {
    switch (expression.type) {
      case "i32":
        if (
          typeof expression.value !== "number" ||
          !Number.isInteger(expression.value) ||
          expression.value < -(2 ** 31) ||
          expression.value >= 2 ** 31
        ) {
          this.add("i32 const value must be an integer in signed 32-bit range");
        }
        break;
      case "i64":
        if (
          typeof expression.value !== "bigint" ||
          expression.value < -(1n << 63n) ||
          expression.value >= 1n << 63n
        ) {
          this.add("i64 const value must be a bigint in signed 64-bit range");
        }
        break;
      case "f32":
        if (typeof expression.value !== "number") {
          this.add("f32 const value must be a number");
        } else if (!Object.is(Math.fround(expression.value), expression.value)) {
          this.add(`f32 const value must be fround-exact: ${expression.value}`);
        }
        break;
      case "f64":
        if (typeof expression.value !== "number") {
          this.add("f64 const value must be a number");
        }
    }
    return expression.type;
  }

  private validateWidth(context: "load" | "store", type: IrType, width: 8 | 16 | undefined): void {
    if (width !== undefined && width !== 8 && width !== 16) {
      this.add(`${context} width must be 8 or 16`);
    }
    if (width !== undefined && !INTEGER_TYPES.has(type)) {
      this.add(`${context} width requires an integer lane`);
    }
  }

  private validateOffset(context: "load" | "store", offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > U32_MAX) {
      this.add(`${context} offset must be an unsigned 32-bit integer`);
    }
  }

  private requireTable(): void {
    if (!this.module.table) this.add("indirect call requires a table");
  }

  private expectType(
    actual: IrType | undefined,
    expected: IrType | undefined,
    subject: string,
  ): void {
    if (actual !== undefined && expected !== undefined && actual !== expected) {
      this.add(`${subject} must be ${expected}, got ${actual}`);
    }
  }

  private unknownExpression(expression: never): void {
    this.add(`validate: unknown IR expression kind: ${(expression as { k?: unknown }).k}`);
  }

  private unknownStatement(statement: never): void {
    this.add(`validate: unknown IR statement kind: ${(statement as { k?: unknown }).k}`);
  }
}

export function validateModule(module: IrModule): string[] {
  return new Validator(module).validate();
}
