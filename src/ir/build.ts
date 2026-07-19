// biome-ignore-all lint/suspicious/noThenProperty: IR branch nodes intentionally use `then`.
import type {
  BinOp,
  ConstExpr,
  ConvOp,
  Expr,
  Func,
  FuncId,
  GlobalId,
  IrModule,
  IrType,
  LabelId,
  LocalId,
  MultiCallCallee,
  Sig,
  SigId,
  Stmt,
  StructLayout,
  UnOp,
} from "./ir";
import { validateModule } from "./validate";

type FuncOptions = { export?: string };
type GlobalOptions = { export?: string };
type BodyBuilder = (fn: FuncBuilder) => void;
type LabeledBodyBuilder = (label: LabelId, fn: FuncBuilder) => void;

function signatureKey(params: IrType[], results: IrType[]): string {
  return `${params.join(",")}->${results.join(",")}`;
}

export class IrBuilder {
  private readonly types: Sig[] = [];
  private readonly signatureIds = new Map<string, SigId>();
  private readonly funcImports: IrModule["funcImports"] = [];
  private readonly globalImports: IrModule["globalImports"] = [];
  private readonly funcs: Func[] = [];
  private readonly globals: IrModule["globals"] = [];
  private memoryConfig: IrModule["memory"] = { initialPages: 1, mode: "owned" };
  private tableConfig: IrModule["table"];
  private readonly dataSegments: IrModule["data"] = [];
  private staticDataEnd = 65_536;
  private readonly layouts = new Map<string, StructLayout>();
  private startId: FuncId | undefined;
  private definitionsStarted = false;
  private readonly funcNames = new Map<FuncId, string>();
  private readonly globalNames = new Map<GlobalId, string>();
  private readonly localNames = new Map<FuncId, Map<LocalId, string>>();

  signature(params: IrType[], results: IrType[]): SigId {
    const key = signatureKey(params, results);
    const existing = this.signatureIds.get(key);
    if (existing !== undefined) return existing;
    const id = this.types.length;
    this.types.push({ params: [...params], results: [...results] });
    this.signatureIds.set(key, id);
    return id;
  }

  getSignature(id: SigId): Sig {
    const sig = this.types[id];
    if (!sig) throw new Error(`unknown IR signature id: ${id}`);
    return sig;
  }

  func(name: string, sigId: SigId, options: FuncOptions = {}): FuncBuilder {
    this.getSignature(sigId);
    this.definitionsStarted = true;
    const id = this.funcImports.length + this.funcs.length;
    const fn: Func = { sig: sigId, locals: [], body: [] };
    if (options.export !== undefined) fn.export = options.export;
    this.funcs.push(fn);
    this.funcNames.set(id, name);
    this.localNames.set(id, new Map());
    return new FuncBuilder(this, id, sigId, fn);
  }

  global(
    name: string,
    type: IrType,
    mutable: boolean,
    init: number | bigint | ConstExpr,
    options: GlobalOptions = {},
  ): GlobalId {
    this.definitionsStarted = true;
    const id = this.globalImports.length + this.globals.length;
    const initializer: ConstExpr =
      typeof init === "object" ? init : { k: "const", type, value: init };
    const global: IrModule["globals"][number] = { type, mutable, init: initializer };
    if (options.export !== undefined) global.export = options.export;
    this.globals.push(global);
    this.globalNames.set(id, name);
    return id;
  }

  data(addr: number, bytes: Uint8Array): void {
    const ownedBytes = bytes.slice();
    this.dataSegments.push({ addr, bytes: ownedBytes });
    this.staticDataEnd = Math.max(this.staticDataEnd, addr + ownedBytes.byteLength);
  }

  memory(mode: "owned" | "imported", pages: number): void {
    this.memoryConfig = { mode, initialPages: pages };
  }

  ensureTable(): void {
    this.tableConfig ??= { entries: [] };
  }

  tableEntry(funcId: FuncId): number {
    this.ensureTable();
    const slot = this.tableConfig!.entries.length;
    this.tableConfig!.entries.push(funcId);
    return slot;
  }

  funcImport(module: string, name: string, sig: SigId): FuncId {
    this.assertImportsOpen();
    this.getSignature(sig);
    const id = this.funcImports.length;
    this.funcImports.push({ module, name, sig });
    this.funcNames.set(id, name);
    return id;
  }

  globalImport(module: string, name: string, type: IrType): GlobalId {
    this.assertImportsOpen();
    const id = this.globalImports.length;
    this.globalImports.push({ module, name, type });
    this.globalNames.set(id, name);
    return id;
  }

  start(funcId: FuncId): void {
    this.startId = funcId;
  }

  structLayout(identity: string, layout: StructLayout): void {
    this.layouts.set(identity, layout);
  }

  setLocalName(funcId: FuncId, localId: LocalId, name: string): void {
    let names = this.localNames.get(funcId);
    if (!names) {
      names = new Map();
      this.localNames.set(funcId, names);
    }
    names.set(localId, name);
  }

  finish(): IrModule {
    const module: IrModule = {
      types: this.types,
      funcImports: this.funcImports,
      globalImports: this.globalImports,
      funcs: this.funcs,
      globals: this.globals,
      memory: this.memoryConfig,
      data: this.dataSegments,
      dataEnd: this.staticDataEnd,
      structLayouts: this.layouts,
      names: {
        funcs: this.funcNames,
        globals: this.globalNames,
        locals: this.localNames,
      },
    };
    if (this.tableConfig !== undefined) module.table = this.tableConfig;
    if (this.startId !== undefined) module.start = this.startId;
    const errors = validateModule(module);
    if (errors.length > 0) throw new Error(`invalid IR module:\n${errors.join("\n")}`);
    return module;
  }

  private assertImportsOpen(): void {
    if (this.definitionsStarted) {
      throw new Error("imports must be declared before definitions");
    }
  }
}

export class FuncBuilder {
  private readonly bodyStack: Stmt[][];
  private readonly activeLabels: LabelId[] = [];
  private branchFloor = 0;
  private nextLabel = 0;

  constructor(
    private readonly module: IrBuilder,
    readonly id: FuncId,
    readonly sigId: SigId,
    private readonly fn: Func,
  ) {
    this.bodyStack = [fn.body];
  }

  get body(): Stmt[] {
    return this.fn.body;
  }

  local(type: IrType, name?: string): LocalId {
    const id = this.module.getSignature(this.sigId).params.length + this.fn.locals.length;
    this.fn.locals.push(type);
    if (name !== undefined) this.module.setLocalName(this.id, id, name);
    return id;
  }

  nameLocal(id: LocalId, name: string): void {
    this.module.setLocalName(this.id, id, name);
  }

  emit(statement: Stmt): this {
    this.currentBody().push(statement);
    return this;
  }

  constant(type: IrType, value: number | bigint): Expr {
    return { k: "const", type, value };
  }

  const(type: IrType, value: number | bigint): Expr {
    return this.constant(type, value);
  }

  localGet(id: LocalId): Expr {
    return { k: "local.get", id };
  }

  globalGet(id: GlobalId): Expr {
    return { k: "global.get", id };
  }

  binop(op: BinOp, type: IrType, signed: boolean, l: Expr, r: Expr): Expr {
    return { k: "binop", op, type, signed, l, r };
  }

  unop(op: UnOp, type: IrType, e: Expr): Expr {
    return { k: "unop", op, type, e };
  }

  convert(op: ConvOp, e: Expr): Expr {
    return { k: "convert", op, e };
  }

  load(type: IrType, addr: Expr, offset = 0, width?: 8 | 16, signed?: boolean): Expr {
    const expression: Extract<Expr, { k: "load" }> = { k: "load", type, addr, offset };
    if (width !== undefined) expression.width = width;
    if (signed !== undefined) expression.signed = signed;
    return expression;
  }

  call(fn: FuncId, args: Expr[]): Expr {
    return { k: "call", fn, args };
  }

  callIndirect(sig: SigId, index: Expr, args: Expr[]): Expr {
    return { k: "call_indirect", sig, index, args };
  }

  ifVal(cond: Expr, thenExpr: Expr, elseExpr: Expr, type: IrType): Expr {
    return { k: "if_val", cond, then: thenExpr, else: elseExpr, type };
  }

  seq(build: BodyBuilder, value: Expr | ((fn: FuncBuilder) => Expr)): Expr {
    const priorFloor = this.branchFloor;
    this.branchFloor = this.activeLabels.length;
    let stmts: Stmt[];
    try {
      stmts = this.capture(build);
    } finally {
      this.branchFloor = priorFloor;
    }
    return { k: "seq", stmts, value: typeof value === "function" ? value(this) : value };
  }

  memorySize(): Expr {
    return { k: "memory.size" };
  }

  memoryGrow(pages: Expr): Expr {
    return { k: "memory.grow", pages };
  }

  localSet(id: LocalId, e: Expr): this {
    return this.emit({ k: "local.set", id, e });
  }

  globalSet(id: GlobalId, e: Expr): this {
    return this.emit({ k: "global.set", id, e });
  }

  store(type: IrType, addr: Expr, value: Expr, offset = 0, width?: 8 | 16): this {
    const statement: Extract<Stmt, { k: "store" }> = {
      k: "store",
      type,
      addr,
      value,
      offset,
    };
    if (width !== undefined) statement.width = width;
    return this.emit(statement);
  }

  callVoid(fn: FuncId, args: Expr[]): this {
    return this.emit({ k: "call", fn, args });
  }

  drop(e: Expr): this {
    return this.emit({ k: "drop", e });
  }

  multiCall(callee: MultiCallCallee, args: Expr[], targets: LocalId[] | null): this {
    return this.emit({ k: "multi_call", callee, args, targets });
  }

  callIndirectVoid(sig: SigId, index: Expr, args: Expr[]): this {
    return this.emit({ k: "call_indirect", sig, index, args });
  }

  if(cond: Expr, thenBuild: BodyBuilder, elseBuild?: BodyBuilder): this {
    const thenBody = this.capture(thenBuild);
    const statement: Extract<Stmt, { k: "if" }> = { k: "if", cond, then: thenBody };
    if (elseBuild !== undefined) statement.else = this.capture(elseBuild);
    return this.emit(statement);
  }

  block(build: LabeledBodyBuilder): this {
    return this.labeled("block", build);
  }

  loop(build: LabeledBodyBuilder): this {
    return this.labeled("loop", build);
  }

  br(label: LabelId): this {
    this.assertBranchTarget(label);
    return this.emit({ k: "br", label });
  }

  brIf(label: LabelId, cond: Expr): this {
    this.assertBranchTarget(label);
    return this.emit({ k: "br_if", label, cond });
  }

  ret(values: Expr[] = []): this {
    return this.emit({ k: "return", values });
  }

  return(values: Expr[] = []): this {
    return this.ret(values);
  }

  unreachable(): this {
    return this.emit({ k: "unreachable" });
  }

  memoryCopy(dest: Expr, src: Expr, len: Expr): this {
    return this.emit({ k: "memory.copy", dest, src, len });
  }

  private labeled(kind: "block" | "loop", build: LabeledBodyBuilder): this {
    const label = this.nextLabel;
    this.nextLabel += 1;
    const body: Stmt[] = [];
    const statement: Extract<Stmt, { k: "block" | "loop" }> = { k: kind, label, body };
    this.emit(statement);
    this.bodyStack.push(body);
    this.activeLabels.push(label);
    try {
      build(label, this);
    } finally {
      this.activeLabels.pop();
      this.bodyStack.pop();
    }
    return this;
  }

  private capture(build: BodyBuilder): Stmt[] {
    const body: Stmt[] = [];
    this.bodyStack.push(body);
    try {
      build(this);
    } finally {
      this.bodyStack.pop();
    }
    return body;
  }

  private assertBranchTarget(label: LabelId): void {
    const index = this.activeLabels.lastIndexOf(label);
    if (index < 0 || index < this.branchFloor) {
      throw new Error(`label ${label} is not active in this body`);
    }
  }

  private currentBody(): Stmt[] {
    return this.bodyStack.at(-1)!;
  }
}
