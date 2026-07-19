import { stmtDefinitelyReturns } from "../compiler/emitters/analysis/flow";
import {
  baseScalar,
  isUnsignedMapleInteger,
  valueTypeToWasm,
} from "../compiler/emitters/emit.types";
import type { ModuleMeta } from "../compiler/emitters/emitter.types";
import type { EmitOptions } from "../compiler/emitters/module";
import { getIntrinsic } from "../compiler/intrinsics";
import type { ASTProgram } from "../parser/ast/ASTProgram";
import { ArrayLiteralExpression } from "../parser/ast/expressions/ArrayLiteralExpression";
import { AssignmentExpression } from "../parser/ast/expressions/AssignmentExpression";
import { BooleanLiteralExpression } from "../parser/ast/expressions/BooleanLiteralExpression";
import { CallExpression } from "../parser/ast/expressions/CallExpression";
import { CastExpression } from "../parser/ast/expressions/CastExpression";
import { CharLiteralExpression } from "../parser/ast/expressions/CharLiteralExpression";
import { FloatLiteralExpression } from "../parser/ast/expressions/FloatLiteralExpression";
import { Identifier } from "../parser/ast/expressions/Identifier";
import { IndexExpression } from "../parser/ast/expressions/IndexExpression";
import { InfixExpression } from "../parser/ast/expressions/InfixExpression";
import { IntegerLiteralExpression } from "../parser/ast/expressions/IntegerLiteral";
import { MemberExpression } from "../parser/ast/expressions/MemberExpression";
import { PointerMemberExpression } from "../parser/ast/expressions/PointerMemberExpression";
import { PostfixExpression } from "../parser/ast/expressions/PostfixExpression";
import { PrefixExpression } from "../parser/ast/expressions/PrefixExpression";
import { StringLiteralExpression } from "../parser/ast/expressions/StringLiteral";
import { StructLiteralExpression } from "../parser/ast/expressions/StructLiteralExpression";
import { BlockStatement } from "../parser/ast/statements/BlockStatement";
import { BreakStatement } from "../parser/ast/statements/BreakStatement";
import { ContinueStatement } from "../parser/ast/statements/ContinueStatement";
import { ExpressionStatement } from "../parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../parser/ast/statements/ForStatement";
import { FunctionStatement } from "../parser/ast/statements/FunctionStatement";
import { IfStatement } from "../parser/ast/statements/IfStatement";
import { ImportStatement } from "../parser/ast/statements/ImportStatement";
import { LetStatement } from "../parser/ast/statements/LetStatement";
import { ReturnStatement } from "../parser/ast/statements/ReturnStatement";
import { StructStatement } from "../parser/ast/statements/StructStatement";
import { SwitchStatement } from "../parser/ast/statements/SwitchStatement";
import { TuplePattern } from "../parser/ast/statements/TuplePattern";
import { WhileStatement } from "../parser/ast/statements/WhileStatement";
import type { ASTExpression, ASTStatement, ResolvedDecl } from "../parser/ast/types/ast.type";
import { alignTo, sizeofType } from "../shared/types";
import { type FuncBuilder, IrBuilder } from "./build";
import type {
  BinOp,
  ConvOp,
  Expr,
  FuncId,
  GlobalId,
  IrModule,
  IrType,
  LabelId,
  LocalId,
  Stmt,
  StructLayout,
  StructLayoutMember,
} from "./ir";
import { structLayout } from "./layout";
import { elemAddr, stringEq, structEqBatch } from "./runtime";

export type PendingInitializer = {
  initializerId: string;
  locals: IrType[];
  statements: Stmt[];
};

export type LoweringResult = {
  module: IrModule;
  pendingInits: PendingInitializer[];
};

type Binding = {
  id: LocalId;
  mapleType: string;
  kind: "local" | "param";
};

type GlobalBinding = {
  id: GlobalId;
  mapleType: string;
};

type ControlTarget = {
  breakLabel: LabelId;
  continueLabel?: LabelId;
};

type FramePlan = {
  size: number;
  offsets: Map<LetStatement, number>;
};

type PendingMemorySite = {
  owner: string;
  ordinal: number;
  baseAddr: number;
  member: StructLayoutMember;
  expression: ASTExpression;
  needsStore: boolean;
};

type IrLvalue = {
  mapleType: string;
  load: () => Expr;
  store: (value: Expr) => void;
};

const COMPOUND_OPERATORS: Record<string, string> = {
  "+=": "+",
  "-=": "-",
  "*=": "*",
  "/=": "/",
  "%=": "%",
  "|=": "|",
  "&=": "&",
  "^=": "^",
  "<<=": "<<",
  ">>=": ">>",
};

function nodeKind(node: object): string {
  return node.constructor.name;
}

function missingAnnotation(node: object): never {
  throw new Error(`lowering: missing annotation on ${nodeKind(node)}`);
}

function unsupported(node: object): never {
  throw new Error(`lowering: unsupported ${nodeKind(node)}`);
}

function resolvedType(expression: ASTExpression): string {
  if (expression.resolvedType === undefined) missingAnnotation(expression);
  return expression.resolvedType;
}

function lane(mapleType: string): IrType {
  return valueTypeToWasm(mapleType);
}

function zero(type: IrType): number | bigint {
  return type === "i64" ? 0n : 0;
}

function one(type: IrType): number | bigint {
  return type === "i64" ? 1n : 1;
}

function signedI32(value: bigint): number {
  return Number(BigInt.asIntN(32, value));
}

function signedI64(value: bigint): bigint {
  return BigInt.asIntN(64, value);
}

function isScalarConstant(expression: ASTExpression): boolean {
  if (
    expression instanceof IntegerLiteralExpression ||
    expression instanceof FloatLiteralExpression ||
    expression instanceof BooleanLiteralExpression ||
    expression instanceof CharLiteralExpression
  ) {
    return true;
  }
  return (
    expression instanceof PrefixExpression &&
    expression.operator === "-" &&
    (expression.right instanceof IntegerLiteralExpression ||
      expression.right instanceof FloatLiteralExpression)
  );
}

function constantInitializer(expression: ASTExpression, targetType: string): number | bigint {
  resolvedType(expression);
  const targetLane = lane(targetType);
  if (expression instanceof IntegerLiteralExpression) {
    return targetLane === "i64" ? signedI64(expression.bigValue) : signedI32(expression.bigValue);
  }
  if (expression instanceof FloatLiteralExpression) return expression.value;
  if (expression instanceof BooleanLiteralExpression) return expression.value ? 1 : 0;
  if (expression instanceof CharLiteralExpression) return expression.value;
  if (expression instanceof PrefixExpression && expression.right) {
    const value = constantInitializer(expression.right, targetType);
    return typeof value === "bigint" ? -value : -value;
  }
  return unsupported(expression);
}

function isDirectStructField(expression: ASTExpression): boolean {
  return (
    expression instanceof IntegerLiteralExpression ||
    expression instanceof FloatLiteralExpression ||
    expression instanceof BooleanLiteralExpression ||
    expression instanceof StringLiteralExpression
  );
}

function widthOf(mapleType: string): 8 | 16 | undefined {
  const type = baseScalar(mapleType);
  if (type === "i8" || type === "u8" || type === "bool") return 8;
  if (type === "i16" || type === "u16") return 16;
  return undefined;
}

function signedLoad(mapleType: string): boolean | undefined {
  const width = widthOf(mapleType);
  if (width === undefined) return undefined;
  const type = baseScalar(mapleType);
  return type === "i8" || type === "i16";
}

function arrayElementType(arrayType: string): string {
  if (arrayType.endsWith("[]")) return arrayType.slice(0, -2);
  if (arrayType.startsWith("*")) return arrayType.slice(1);
  throw new Error(`lowering: type '${arrayType}' is not indexable`);
}

function structIdentity(mapleType: string): string {
  return mapleType.startsWith("*") ? mapleType.slice(1) : mapleType;
}

function encodePointer(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function encodeConstant(expression: ASTExpression, targetType: string): Uint8Array {
  const type = baseScalar(targetType);
  const bytes = new Uint8Array(sizeofType(type));
  const view = new DataView(bytes.buffer);
  const value = constantInitializer(expression, targetType);
  switch (type) {
    case "i8":
      view.setInt8(0, Number(value));
      break;
    case "u8":
    case "bool":
      view.setUint8(0, Number(value));
      break;
    case "i16":
      view.setInt16(0, Number(value), true);
      break;
    case "u16":
      view.setUint16(0, Number(value), true);
      break;
    case "i32":
      view.setInt32(0, Number(value), true);
      break;
    case "u32":
      view.setUint32(0, Number(value), true);
      break;
    case "i64":
      view.setBigInt64(0, BigInt.asIntN(64, BigInt(value)), true);
      break;
    case "u64":
      view.setBigUint64(0, BigInt.asUintN(64, BigInt(value)), true);
      break;
    case "f32":
      view.setFloat32(0, Number(value), true);
      break;
    case "f64":
      view.setFloat64(0, Number(value), true);
      break;
    default:
      throw new Error(`lowering: unsupported static type '${targetType}'`);
  }
  return bytes;
}

function copyBytes(target: Uint8Array, offset: number, bytes: Uint8Array): void {
  target.set(bytes, offset);
}

class StaticDataPlanner {
  readonly addresses = new Map<ASTExpression, number>();
  readonly pendingSites: PendingMemorySite[] = [];
  private cursor = 65_536;

  constructor(
    private readonly builder: IrBuilder,
    private readonly layouts: Map<string, StructLayout>,
  ) {}

  get dataEnd(): number {
    return this.cursor;
  }

  scan(program: ASTProgram): void {
    for (const statement of program.statements) this.visitStatement(statement, false);
  }

  private allocate(bytes: Uint8Array, alignment: number): number {
    const address = this.reserve(bytes.byteLength, alignment);
    this.builder.data(address, bytes);
    return address;
  }

  private reserve(size: number, alignment: number): number {
    const address = alignTo(this.cursor, alignment);
    this.cursor = address + size;
    return address;
  }

  private visitStatement(statement: ASTStatement, insideFunction: boolean): void {
    if (statement instanceof FunctionStatement) {
      this.visitStatement(statement.fnExpr.body, true);
      return;
    }
    if (statement instanceof BlockStatement) {
      for (const child of statement.statements) this.visitStatement(child, insideFunction);
      return;
    }
    if (statement instanceof LetStatement) {
      if (!statement.expression) return;
      if (statement.expression instanceof StructLiteralExpression) {
        if (insideFunction) this.visitLocalStruct(statement.expression);
        else this.allocateGlobalStruct(statement.expression, statement.identifier.tokenLiteral());
      } else {
        this.visitExpression(statement.expression);
      }
      return;
    }
    if (statement instanceof ReturnStatement) {
      for (const value of statement.returnValues) this.visitExpression(value);
      return;
    }
    if (statement instanceof ExpressionStatement) {
      if (statement.expression) this.visitExpression(statement.expression);
      return;
    }
    if (statement instanceof IfStatement) {
      this.visitExpression(statement.conditionExpr);
      this.visitStatement(statement.thenBlock, insideFunction);
      if (statement.elseBlock) this.visitStatement(statement.elseBlock, insideFunction);
      return;
    }
    if (statement instanceof WhileStatement) {
      this.visitExpression(statement.condExpr);
      this.visitStatement(statement.loopBody, insideFunction);
      return;
    }
    if (statement instanceof ForStatement) {
      this.visitStatement(statement.initBlock, insideFunction);
      if (statement.conditionExpr.expression)
        this.visitExpression(statement.conditionExpr.expression);
      if (statement.updateExpr.expression) this.visitExpression(statement.updateExpr.expression);
      this.visitStatement(statement.loopBody, insideFunction);
      return;
    }
    if (statement instanceof SwitchStatement) {
      this.visitExpression(statement.switchExpr);
      for (const branch of statement.cases) this.visitStatement(branch.body, insideFunction);
      if (statement.default) this.visitStatement(statement.default, insideFunction);
    }
  }

  private visitExpression(expression: ASTExpression): void {
    if (expression instanceof StringLiteralExpression) {
      this.allocateString(expression);
      return;
    }
    if (expression instanceof ArrayLiteralExpression) {
      this.allocateArray(expression);
      return;
    }
    if (expression instanceof StructLiteralExpression) {
      this.allocateStaticStruct(expression);
      return;
    }
    if (expression instanceof AssignmentExpression) {
      this.visitExpression(expression.left);
      if (expression.value) this.visitExpression(expression.value);
      return;
    }
    if (expression instanceof CallExpression) {
      for (const argument of expression.args) this.visitExpression(argument);
      return;
    }
    if (expression instanceof InfixExpression) {
      this.visitExpression(expression.left);
      this.visitExpression(expression.right);
      return;
    }
    if (expression instanceof IndexExpression) {
      this.visitExpression(expression.left);
      this.visitExpression(expression.index);
      return;
    }
    if (expression instanceof MemberExpression || expression instanceof PointerMemberExpression) {
      this.visitExpression(expression.parent);
      return;
    }
    if (expression instanceof PrefixExpression) {
      if (expression.right) this.visitExpression(expression.right);
      return;
    }
    if (expression instanceof PostfixExpression) {
      if (expression.left) this.visitExpression(expression.left);
      return;
    }
    if (expression instanceof CastExpression) this.visitExpression(expression.expr);
  }

  private allocateString(expression: StringLiteralExpression): number {
    const existing = this.addresses.get(expression);
    if (existing !== undefined) return existing;
    resolvedType(expression);
    const payload = new TextEncoder().encode(expression.value);
    const dataAddress = this.allocate(payload, 4);
    const header = new Uint8Array(8);
    const view = new DataView(header.buffer);
    view.setUint32(0, payload.byteLength, true);
    view.setUint32(4, dataAddress, true);
    const address = this.allocate(header, 4);
    this.addresses.set(expression, address);
    return address;
  }

  private allocateArray(expression: ArrayLiteralExpression): number {
    const existing = this.addresses.get(expression);
    if (existing !== undefined) return existing;
    resolvedType(expression);
    const elementType = expression.memberType;
    const elementSize = sizeofType(elementType);
    const data = new Uint8Array(elementSize * expression.elements.length);
    for (let index = 0; index < expression.elements.length; index += 1) {
      const element = expression.elements[index]!;
      this.visitExpression(element);
      const encoded =
        element instanceof StringLiteralExpression ||
        element instanceof ArrayLiteralExpression ||
        element instanceof StructLiteralExpression
          ? encodePointer(this.addressOf(element))
          : encodeConstant(element, elementType);
      copyBytes(data, index * elementSize, encoded);
    }
    const dataAddress = this.allocate(data, Math.min(8, Math.max(1, elementSize)));
    const header = new Uint8Array(8);
    const view = new DataView(header.buffer);
    view.setUint32(0, expression.elements.length, true);
    view.setUint32(4, dataAddress, true);
    const address = this.allocate(header, 4);
    this.addresses.set(expression, address);
    return address;
  }

  private visitLocalStruct(expression: StructLiteralExpression): void {
    resolvedType(expression);
    const layout = this.requireLayout(expression.name);
    for (const member of layout.members) {
      const value = expression.members[member.name];
      if (!value) throw new Error(`lowering: struct '${expression.name}' missing '${member.name}'`);
      this.visitExpression(value);
    }
  }

  private allocateGlobalStruct(expression: StructLiteralExpression, owner: string): number {
    const existing = this.addresses.get(expression);
    if (existing !== undefined) return existing;
    resolvedType(expression);
    const layout = this.requireLayout(expression.name);
    const address = this.reserve(layout.size, 8);
    this.addresses.set(expression, address);
    const bytes = new Uint8Array(layout.size);
    let ordinal = 0;
    for (const member of layout.members) {
      const value = expression.members[member.name];
      if (!value) throw new Error(`lowering: struct '${expression.name}' missing '${member.name}'`);
      this.visitExpression(value);
      const encoded = this.staticField(value, member.mapleType);
      if (encoded) copyBytes(bytes, member.offset, encoded);
      if (!isDirectStructField(value)) {
        this.pendingSites.push({
          owner,
          ordinal,
          baseAddr: address,
          member,
          expression: value,
          needsStore: encoded === undefined,
        });
        ordinal += 1;
      }
    }
    this.builder.data(address, bytes);
    return address;
  }

  private allocateStaticStruct(expression: StructLiteralExpression): number {
    const existing = this.addresses.get(expression);
    if (existing !== undefined) return existing;
    resolvedType(expression);
    const layout = this.requireLayout(expression.name);
    const address = this.reserve(layout.size, 8);
    this.addresses.set(expression, address);
    const bytes = new Uint8Array(layout.size);
    for (const member of layout.members) {
      const value = expression.members[member.name];
      if (!value) throw new Error(`lowering: struct '${expression.name}' missing '${member.name}'`);
      this.visitExpression(value);
      const encoded = this.staticField(value, member.mapleType);
      if (encoded) copyBytes(bytes, member.offset, encoded);
    }
    this.builder.data(address, bytes);
    return address;
  }

  private staticField(expression: ASTExpression, mapleType: string): Uint8Array | undefined {
    if (
      expression instanceof StringLiteralExpression ||
      expression instanceof ArrayLiteralExpression ||
      expression instanceof StructLiteralExpression
    ) {
      return encodePointer(this.addressOf(expression));
    }
    if (isScalarConstant(expression)) return encodeConstant(expression, mapleType);
    if (expression instanceof CharLiteralExpression) return encodeConstant(expression, mapleType);
    return undefined;
  }

  addressOf(expression: ASTExpression): number {
    const address = this.addresses.get(expression);
    if (address === undefined)
      throw new Error(`lowering: missing static address for ${nodeKind(expression)}`);
    return address;
  }

  private requireLayout(identity: string): StructLayout {
    const layout = this.layouts.get(identity);
    if (!layout) throw new Error(`lowering: unknown struct layout '${identity}'`);
    return layout;
  }
}

class RuntimeHelpers {
  private elemAddrId: FuncId | undefined;
  private stringEqId: FuncId | undefined;
  private readonly structCalls: Array<{
    identity: string;
    expression: Extract<Expr, { k: "call" }>;
  }> = [];

  constructor(
    private readonly builder: IrBuilder,
    private readonly layouts: Map<string, StructLayout>,
  ) {}

  elemAddr(): FuncId {
    this.elemAddrId ??= elemAddr(this.builder);
    return this.elemAddrId;
  }

  stringEq(): FuncId {
    this.stringEqId ??= stringEq(this.builder);
    return this.stringEqId;
  }

  structEq(identity: string, args: Expr[]): Expr {
    if (!this.layouts.has(identity))
      throw new Error(`lowering: unknown struct layout '${identity}'`);
    const expression: Extract<Expr, { k: "call" }> = { k: "call", fn: -1, args };
    this.structCalls.push({ identity, expression });
    return expression;
  }

  finish(): void {
    if (this.structCalls.length === 0) return;
    const closure = new Map<string, StructLayout>();
    let needsStrings = false;
    const add = (identity: string): void => {
      if (closure.has(identity)) return;
      const layout = this.layouts.get(identity);
      if (!layout) throw new Error(`lowering: unknown struct layout '${identity}'`);
      closure.set(identity, layout);
      for (const member of layout.members) {
        if (member.mapleType === "string" || member.memberIdentity === "string") {
          needsStrings = true;
        } else if (member.memberIdentity !== undefined) {
          add(member.memberIdentity);
        }
      }
    };
    for (const request of this.structCalls) add(request.identity);
    const ids = structEqBatch(this.builder, closure, needsStrings ? this.stringEq() : undefined);
    for (const request of this.structCalls) request.expression.fn = ids.get(request.identity)!;
  }
}

function planFrame(block: BlockStatement, layouts: Map<string, StructLayout>): FramePlan {
  const offsets = new Map<LetStatement, number>();
  let size = 0;
  const walk = (statement: ASTStatement): void => {
    if (statement instanceof LetStatement) {
      if (statement.expression instanceof StructLiteralExpression) {
        const layout = layouts.get(statement.expression.name);
        if (!layout)
          throw new Error(`lowering: unknown struct layout '${statement.expression.name}'`);
        offsets.set(statement, size);
        size += layout.size;
      }
      return;
    }
    if (statement instanceof BlockStatement) {
      for (const child of statement.statements) walk(child);
      return;
    }
    if (statement instanceof IfStatement) {
      walk(statement.thenBlock);
      if (statement.elseBlock) walk(statement.elseBlock);
      return;
    }
    if (statement instanceof WhileStatement) {
      walk(statement.loopBody);
      return;
    }
    if (statement instanceof ForStatement) {
      walk(statement.initBlock);
      walk(statement.loopBody);
      return;
    }
    if (statement instanceof SwitchStatement) {
      for (const branch of statement.cases) walk(branch.body);
      if (statement.default) walk(statement.default);
    }
  };
  walk(block);
  return { size, offsets };
}

class FunctionLowerer {
  private readonly scopes: Array<Map<string, Binding>> = [];
  private readonly controls: ControlTarget[] = [];

  constructor(
    private readonly fn: FuncBuilder,
    private readonly functions: Map<string, FuncId>,
    private readonly globals: Map<string, GlobalBinding>,
    params: Array<{ name: string; type: string }>,
    private readonly layouts: Map<string, StructLayout>,
    private readonly staticData: StaticDataPlanner,
    private readonly runtime: RuntimeHelpers,
    private readonly frame: FramePlan = { size: 0, offsets: new Map() },
    private readonly stackPointer?: GlobalId,
    private readonly fragmentLocals?: IrType[],
  ) {
    const paramScope = new Map<string, Binding>();
    for (let index = 0; index < params.length; index += 1) {
      const param = params[index]!;
      paramScope.set(param.name, { id: index, mapleType: param.type, kind: "param" });
      fn.nameLocal(index, param.name);
    }
    this.scopes.push(paramScope);
  }

  lowerBody(block: BlockStatement): void {
    if (this.frame.size > 0) {
      if (this.stackPointer === undefined) throw new Error("lowering: missing shadow stack");
      this.fn.globalSet(
        this.stackPointer,
        this.fn.binop(
          "sub",
          "i32",
          false,
          this.fn.globalGet(this.stackPointer),
          this.fn.constant("i32", this.frame.size),
        ),
      );
    }
    this.lowerBlock(block);
    this.restoreFrame();
    if (this.frame.size > 0 && stmtDefinitelyReturns(block)) this.fn.unreachable();
  }

  lowerPendingStore(address: number, mapleType: string, expression: ASTExpression): void {
    this.fn.store(
      lane(mapleType),
      this.fn.constant("i32", address),
      this.lowerExpression(expression),
      0,
      widthOf(mapleType),
    );
  }

  private local(type: IrType, name?: string): LocalId {
    this.fragmentLocals?.push(type);
    return this.fn.local(type, name);
  }

  private restoreFrame(): void {
    if (this.frame.size === 0) return;
    if (this.stackPointer === undefined) throw new Error("lowering: missing shadow stack");
    this.fn.globalSet(
      this.stackPointer,
      this.fn.binop(
        "add",
        "i32",
        false,
        this.fn.globalGet(this.stackPointer),
        this.fn.constant("i32", this.frame.size),
      ),
    );
  }

  private lowerBlock(block: BlockStatement): void {
    this.scopes.push(new Map());
    try {
      for (const statement of block.statements) this.lowerStatement(statement);
    } finally {
      this.scopes.pop();
    }
  }

  private lowerStatement(statement: ASTStatement): void {
    if (statement instanceof BlockStatement) {
      this.lowerBlock(statement);
      return;
    }
    if (statement instanceof LetStatement) {
      this.lowerLet(statement);
      return;
    }
    if (statement instanceof ReturnStatement) {
      this.lowerReturn(statement);
      return;
    }
    if (statement instanceof ExpressionStatement) {
      if (statement.expression) this.lowerEffect(statement.expression);
      return;
    }
    if (statement instanceof IfStatement) {
      this.fn.if(
        this.truthy(statement.conditionExpr),
        () => this.lowerBlock(statement.thenBlock),
        statement.elseBlock ? () => this.lowerBlock(statement.elseBlock!) : undefined,
      );
      if (stmtDefinitelyReturns(statement)) this.fn.unreachable();
      return;
    }
    if (statement instanceof WhileStatement) {
      this.lowerWhile(statement);
      return;
    }
    if (statement instanceof ForStatement) {
      this.lowerFor(statement);
      return;
    }
    if (statement instanceof SwitchStatement) {
      this.lowerSwitch(statement);
      if (stmtDefinitelyReturns(statement)) this.fn.unreachable();
      return;
    }
    if (statement instanceof BreakStatement) {
      const target = this.controls.at(-1);
      if (!target) unsupported(statement);
      this.fn.br(target.breakLabel);
      return;
    }
    if (statement instanceof ContinueStatement) {
      const target = this.findContinueTarget();
      if (target === undefined) unsupported(statement);
      this.fn.br(target);
      return;
    }
    unsupported(statement);
  }

  private lowerLet(statement: LetStatement): void {
    if (statement.pattern instanceof TuplePattern) {
      this.lowerDestructure(statement);
      return;
    }
    const name = statement.identifier.tokenLiteral();
    if (statement.expression instanceof StructLiteralExpression) {
      this.lowerStructLet(statement, name, statement.expression);
      return;
    }
    const localType = lane(statement.typeAnnotation);
    const id = this.local(localType, statement.resolvedName ?? name);
    const value = statement.expression
      ? this.lowerExpression(statement.expression)
      : this.fn.constant(localType, zero(localType));
    this.fn.localSet(id, value);
    this.scopes.at(-1)!.set(name, {
      id,
      mapleType: statement.typeAnnotation,
      kind: "local",
    });
  }

  private lowerStructLet(
    statement: LetStatement,
    name: string,
    expression: StructLiteralExpression,
  ): void {
    resolvedType(expression);
    const layout = this.layouts.get(expression.name);
    const offset = this.frame.offsets.get(statement);
    if (!layout || offset === undefined || this.stackPointer === undefined) unsupported(expression);
    const id = this.local("i32", statement.resolvedName ?? name);
    const pointer =
      offset === 0
        ? this.fn.globalGet(this.stackPointer)
        : this.fn.binop(
            "add",
            "i32",
            false,
            this.fn.globalGet(this.stackPointer),
            this.fn.constant("i32", offset),
          );
    this.fn.localSet(id, pointer);
    for (const member of layout.members) {
      const value = expression.members[member.name];
      if (!value) throw new Error(`lowering: struct '${expression.name}' missing '${member.name}'`);
      this.fn.store(
        member.lane,
        this.fn.localGet(id),
        this.lowerExpression(value),
        member.offset,
        member.width,
      );
    }
    this.scopes.at(-1)!.set(name, {
      id,
      mapleType: expression.name,
      kind: "local",
    });
  }

  private lowerDestructure(statement: LetStatement): void {
    if (
      !(statement.pattern instanceof TuplePattern) ||
      !(statement.expression instanceof CallExpression)
    ) {
      unsupported(statement);
    }
    const call = this.callAnnotations(statement.expression);
    if (call.results.length < 2) unsupported(statement.expression);
    const targets: LocalId[] = [];
    const bindings: Array<{ name: string; binding: Binding }> = [];
    for (let index = 0; index < call.results.length; index += 1) {
      const part = statement.pattern.names[index];
      const resultType = call.results[index]!;
      const localName = part?.kind === "name" ? part.value : `__discard_${index}`;
      const id = this.local(lane(resultType), localName);
      targets.push(id);
      if (part?.kind === "name") {
        bindings.push({
          name: part.value,
          binding: { id, mapleType: resultType, kind: "local" },
        });
      }
    }
    this.fn.multiCall(
      { kind: "func", fn: this.directCallee(statement.expression, call.decl) },
      statement.expression.args.map((argument) => this.lowerExpression(argument)),
      targets,
    );
    for (const { name, binding } of bindings) this.scopes.at(-1)!.set(name, binding);
  }

  private lowerReturn(statement: ReturnStatement): void {
    if (
      statement.returnValues.length === 1 &&
      statement.returnValues[0] instanceof CallExpression
    ) {
      const callExpression = statement.returnValues[0];
      const call = this.callAnnotations(callExpression);
      if (call.results.length > 1) {
        const targets = call.results.map((type, index) =>
          this.local(lane(type), `__return_${index}`),
        );
        this.fn.multiCall(
          { kind: "func", fn: this.directCallee(callExpression, call.decl) },
          callExpression.args.map((argument) => this.lowerExpression(argument)),
          targets,
        );
        this.restoreFrame();
        this.fn.ret(targets.map((target) => this.fn.localGet(target)));
        return;
      }
    }
    if (this.frame.size === 0) {
      this.fn.ret(statement.returnValues.map((value) => this.lowerExpression(value)));
      return;
    }
    const targets = statement.returnValues.map((value, index) =>
      this.local(lane(resolvedType(value)), `__return_${index}`),
    );
    for (let index = 0; index < statement.returnValues.length; index += 1) {
      this.fn.localSet(targets[index]!, this.lowerExpression(statement.returnValues[index]!));
    }
    this.restoreFrame();
    this.fn.ret(targets.map((target) => this.fn.localGet(target)));
  }

  private lowerEffect(expression: ASTExpression): void {
    if (expression instanceof AssignmentExpression) {
      this.lowerAssignment(expression);
      return;
    }
    if (expression instanceof PostfixExpression) {
      this.lowerPostfixStatement(expression);
      return;
    }
    if (expression instanceof CallExpression) {
      const call = this.callAnnotations(expression);
      if (call.decl.kind === "intrinsic") {
        if (call.results.length === 0) this.lowerVoidIntrinsic(expression);
        else if (call.results.length === 1) this.fn.drop(this.lowerIntrinsic(expression));
        else unsupported(expression);
        return;
      }
      const callee = this.directCallee(expression, call.decl);
      const args = expression.args.map((argument) => this.lowerExpression(argument));
      if (call.results.length === 0) this.fn.callVoid(callee, args);
      else if (call.results.length === 1) this.fn.drop(this.fn.call(callee, args));
      else this.fn.multiCall({ kind: "func", fn: callee }, args, null);
      return;
    }
    unsupported(expression);
  }

  private lowerAssignment(expression: AssignmentExpression): void {
    if (expression.value === null) unsupported(expression);
    const target = this.resolveLvalue(expression.left);
    let value: Expr;
    const operator = COMPOUND_OPERATORS[expression.operator];
    if (operator === undefined) {
      value = this.lowerExpression(expression.value);
    } else {
      value = this.lowerBinaryOperands(operator, target.mapleType, target.load, () =>
        this.lowerExpression(expression.value!),
      );
    }
    target.store(value);
  }

  private lowerPostfixStatement(expression: PostfixExpression): void {
    if (!expression.left) unsupported(expression);
    const target = this.resolveLvalue(expression.left);
    const type = lane(target.mapleType);
    const operator = expression.operator === "++" ? "add" : "sub";
    const value = this.fn.binop(
      operator,
      type,
      !isUnsignedMapleInteger(target.mapleType),
      target.load(),
      this.fn.constant(type, one(type)),
    );
    target.store(value);
  }

  private lowerWhile(statement: WhileStatement): void {
    this.fn.block((breakLabel, block) => {
      block.loop((loopLabel, loop) => {
        loop.brIf(breakLabel, loop.unop("eqz", "i32", this.truthy(statement.condExpr)));
        this.withControl({ breakLabel, continueLabel: loopLabel }, () =>
          this.lowerBlock(statement.loopBody),
        );
        loop.br(loopLabel);
      });
    });
  }

  private lowerFor(statement: ForStatement): void {
    this.scopes.push(new Map());
    try {
      this.lowerLet(statement.initBlock);
      this.fn.block((breakLabel, block) => {
        block.loop((loopLabel, loop) => {
          const condition = statement.conditionExpr.expression;
          if (!condition) unsupported(statement.conditionExpr);
          loop.brIf(breakLabel, loop.unop("eqz", "i32", this.truthy(condition)));
          loop.block((continueLabel) => {
            this.withControl({ breakLabel, continueLabel }, () =>
              this.lowerBlock(statement.loopBody),
            );
          });
          if (statement.updateExpr.expression) this.lowerEffect(statement.updateExpr.expression);
          loop.br(loopLabel);
        });
      });
    } finally {
      this.scopes.pop();
    }
  }

  private lowerSwitch(statement: SwitchStatement): void {
    const selectorType = resolvedType(statement.switchExpr);
    const selectorLane = lane(selectorType);
    if (selectorLane !== "i32") unsupported(statement.switchExpr);
    const selector = this.local("i32", "__switch");
    this.fn.localSet(selector, this.lowerExpression(statement.switchExpr));
    this.fn.block((breakLabel) => {
      this.withControl({ breakLabel }, () => {
        this.fn.block((defaultLabel, defaultBlock) => {
          const labels: LabelId[] = [];
          const nestCases = (index: number, body: FuncBuilder): void => {
            if (index < 0) {
              for (let caseIndex = 0; caseIndex < statement.cases.length; caseIndex += 1) {
                const entry = statement.cases[caseIndex]!;
                body.brIf(
                  labels[caseIndex]!,
                  body.binop(
                    "eq",
                    "i32",
                    true,
                    body.localGet(selector),
                    body.constant("i32", entry.test),
                  ),
                );
              }
              body.br(defaultLabel);
              return;
            }
            body.block((caseLabel, inner) => {
              labels[index] = caseLabel;
              nestCases(index - 1, inner);
            });
            this.lowerBlock(statement.cases[index]!.body);
            body.br(breakLabel);
          };
          nestCases(statement.cases.length - 1, defaultBlock);
        });
        if (statement.default) this.lowerBlock(statement.default);
      });
    });
  }

  private lowerExpression(expression: ASTExpression): Expr {
    if (
      expression instanceof StructLiteralExpression ||
      expression instanceof ArrayLiteralExpression ||
      expression instanceof StringLiteralExpression
    ) {
      resolvedType(expression);
      return this.fn.constant("i32", this.staticData.addressOf(expression));
    }
    if (expression instanceof IndexExpression) return this.lowerIndex(expression);
    if (expression instanceof MemberExpression || expression instanceof PointerMemberExpression) {
      return this.lowerMember(expression);
    }
    if (expression instanceof IntegerLiteralExpression) {
      const type = lane(resolvedType(expression));
      return this.fn.constant(
        type,
        type === "i64" ? signedI64(expression.bigValue) : signedI32(expression.bigValue),
      );
    }
    if (expression instanceof FloatLiteralExpression) {
      return this.fn.constant(lane(resolvedType(expression)), expression.value);
    }
    if (expression instanceof BooleanLiteralExpression) {
      resolvedType(expression);
      return this.fn.constant("i32", expression.value ? 1 : 0);
    }
    if (expression instanceof CharLiteralExpression) {
      resolvedType(expression);
      return this.fn.constant("i32", expression.value);
    }
    if (expression instanceof Identifier) return this.lowerIdentifier(expression);
    if (expression instanceof InfixExpression) return this.lowerInfix(expression);
    if (expression instanceof PrefixExpression) return this.lowerPrefix(expression);
    if (expression instanceof PostfixExpression) return this.lowerPostfixValue(expression);
    if (expression instanceof CastExpression) return this.lowerCast(expression);
    if (expression instanceof CallExpression) {
      const call = this.callAnnotations(expression);
      if (call.results.length !== 1) return unsupported(expression);
      resolvedType(expression);
      if (call.decl.kind === "intrinsic") return this.lowerIntrinsic(expression);
      return this.fn.call(
        this.directCallee(expression, call.decl),
        expression.args.map((argument) => this.lowerExpression(argument)),
      );
    }
    return unsupported(expression);
  }

  private lowerIdentifier(expression: Identifier): Expr {
    resolvedType(expression);
    const annotated = expression as ASTExpression;
    const declaration = annotated.resolvedDecl;
    if (!declaration) return missingAnnotation(expression);
    if (declaration.kind === "local" || declaration.kind === "param") {
      const binding = this.findLocal(declaration.name);
      if (!binding) return unsupported(expression);
      return this.fn.localGet(binding.id);
    }
    if (declaration.kind === "global") {
      const binding = this.globals.get(declaration.name);
      if (!binding) return unsupported(expression);
      return this.fn.globalGet(binding.id);
    }
    return unsupported(expression);
  }

  private lowerMember(expression: MemberExpression | PointerMemberExpression): Expr {
    resolvedType(expression);
    const member = this.resolveMember(resolvedType(expression.parent), expression.member);
    return this.fn.load(
      member.lane,
      this.lowerExpression(expression.parent),
      member.offset,
      member.width,
      signedLoad(member.mapleType),
    );
  }

  private lowerIndex(expression: IndexExpression): Expr {
    const elementType = resolvedType(expression);
    const baseType = resolvedType(expression.left);
    resolvedType(expression.index);
    const declaredElement = arrayElementType(baseType);
    if (elementType !== declaredElement) {
      throw new Error(
        `lowering: index annotation mismatch '${elementType}' and '${declaredElement}'`,
      );
    }
    const base = this.local("i32", "__index_base");
    const index = this.local("i32", "__index");
    const address = this.fn.seq(
      (body) => {
        body.localSet(base, this.lowerExpression(expression.left));
        body.localSet(index, this.lowerExpression(expression.index));
      },
      (body) =>
        body.call(this.runtime.elemAddr(), [
          body.localGet(base),
          body.localGet(index),
          body.constant("i32", sizeofType(elementType)),
        ]),
    );
    return this.fn.load(
      lane(elementType),
      address,
      0,
      widthOf(elementType),
      signedLoad(elementType),
    );
  }

  private resolveMember(parentType: string, name: string): StructLayoutMember {
    const identity = parentType.endsWith("[]") ? "string" : structIdentity(parentType);
    const layout = this.layouts.get(identity);
    const member = layout?.members.find((entry) => entry.name === name);
    if (!member) throw new Error(`lowering: struct '${identity}' has no member '${name}'`);
    return member;
  }

  private lowerInfix(expression: InfixExpression): Expr {
    resolvedType(expression);
    if (expression.operator === "&&" || expression.operator === "||") {
      const left = this.truthy(expression.left);
      if (expression.operator === "&&") {
        return this.fn.ifVal(
          left,
          this.truthy(expression.right),
          this.fn.constant("i32", 0),
          "i32",
        );
      }
      return this.fn.ifVal(left, this.fn.constant("i32", 1), this.truthy(expression.right), "i32");
    }
    const operandType = resolvedType(expression.left);
    resolvedType(expression.right);
    if (expression.operator === "==" || expression.operator === "!=") {
      let equal: Expr | undefined;
      if (operandType === "string") {
        equal = this.fn.call(this.runtime.stringEq(), [
          this.lowerExpression(expression.left),
          this.lowerExpression(expression.right),
        ]);
      } else {
        const identity = structIdentity(operandType);
        if (this.layouts.has(identity) && identity !== "string") {
          equal = this.runtime.structEq(identity, [
            this.lowerExpression(expression.left),
            this.lowerExpression(expression.right),
          ]);
        }
      }
      if (equal) {
        return expression.operator === "==" ? equal : this.fn.unop("eqz", "i32", equal);
      }
    }
    return this.lowerBinaryOperands(
      expression.operator,
      operandType,
      () => this.lowerExpression(expression.left),
      () => this.lowerExpression(expression.right),
    );
  }

  private lowerBinaryOperands(
    operator: string,
    mapleType: string,
    left: () => Expr,
    right: () => Expr,
  ): Expr {
    const type = lane(mapleType);
    const signed = !isUnsignedMapleInteger(mapleType);
    if (operator === "%" && (type === "f32" || type === "f64")) {
      const leftLocal = this.local(type, "__rem_left");
      const rightLocal = this.local(type, "__rem_right");
      return this.fn.seq(
        (body) => {
          body.localSet(leftLocal, left());
          body.localSet(rightLocal, right());
        },
        (body) => {
          const leftValue = body.localGet(leftLocal);
          const rightValue = body.localGet(rightLocal);
          const quotient = body.binop("div", type, false, leftValue, rightValue);
          const truncated = body.unop("trunc", type, quotient);
          return body.binop(
            "sub",
            type,
            false,
            leftValue,
            body.binop("mul", type, false, truncated, rightValue),
          );
        },
      );
    }
    const op = this.binaryOperator(operator);
    return this.fn.binop(op, type, signed, left(), right());
  }

  private binaryOperator(operator: string): BinOp {
    const operators: Record<string, BinOp> = {
      "+": "add",
      "-": "sub",
      "*": "mul",
      "/": "div",
      "%": "rem",
      "&": "and",
      "|": "or",
      "^": "xor",
      "<<": "shl",
      ">>": "shr",
      "==": "eq",
      "!=": "ne",
      "<": "lt",
      "<=": "le",
      ">": "gt",
      ">=": "ge",
    };
    const op = operators[operator];
    if (!op) throw new Error(`lowering: unsupported binary operator ${operator}`);
    return op;
  }

  private lowerPrefix(expression: PrefixExpression): Expr {
    resolvedType(expression);
    if (!expression.right) return unsupported(expression);
    const sourceType = resolvedType(expression.right);
    const type = lane(sourceType);
    const value = this.lowerExpression(expression.right);
    if (expression.operator === "!") {
      if (type === "i32" || type === "i64") return this.fn.unop("eqz", type, value);
      return this.fn.binop("eq", type, false, value, this.fn.constant(type, 0));
    }
    if (expression.operator === "-") {
      if (type === "f32" || type === "f64") return this.fn.unop("neg", type, value);
      return this.fn.binop(
        "sub",
        type,
        !isUnsignedMapleInteger(sourceType),
        this.fn.constant(type, zero(type)),
        value,
      );
    }
    if (expression.operator === "~") {
      return this.fn.binop(
        "xor",
        type,
        !isUnsignedMapleInteger(sourceType),
        value,
        this.fn.constant(type, type === "i64" ? -1n : -1),
      );
    }
    return unsupported(expression);
  }

  private lowerPostfixValue(expression: PostfixExpression): Expr {
    resolvedType(expression);
    if (!(expression.left instanceof Identifier)) return unsupported(expression);
    const binding = this.resolveWritable(expression.left);
    const type = lane(binding.mapleType);
    const old = this.local(type, "__postfix_old");
    const op = expression.operator === "++" ? "add" : "sub";
    return this.fn.seq(
      (body) => {
        body.localSet(old, this.bindingGet(binding));
        this.bindingSet(
          binding,
          body.binop(
            op,
            type,
            !isUnsignedMapleInteger(binding.mapleType),
            body.localGet(old),
            body.constant(type, one(type)),
          ),
        );
      },
      (body) => body.localGet(old),
    );
  }

  private lowerCast(expression: CastExpression): Expr {
    const sourceMapleType = resolvedType(expression.expr);
    const targetMapleType = resolvedType(expression);
    const sourceLane = lane(sourceMapleType);
    const targetLane = lane(targetMapleType);
    let value = this.lowerExpression(expression.expr);
    if (sourceLane !== targetLane) {
      value = this.fn.convert(
        this.conversion(sourceLane, targetLane, sourceMapleType, targetMapleType),
        value,
      );
    }
    const targetBase = baseScalar(targetMapleType);
    if (targetLane === "i32" && ["i8", "u8", "i16", "u16"].includes(targetBase)) {
      const width = targetBase.endsWith("8") ? 8 : 16;
      const mask = width === 8 ? 0xff : 0xffff;
      if (sourceLane === "f32" || sourceLane === "f64" || targetBase.startsWith("u")) {
        value = this.fn.binop("and", "i32", false, value, this.fn.constant("i32", mask));
      } else {
        value = this.fn.convert(width === 8 ? "i32.extend8_s" : "i32.extend16_s", value);
      }
    }
    return value;
  }

  private conversion(
    source: IrType,
    target: IrType,
    sourceMapleType: string,
    targetMapleType: string,
  ): ConvOp {
    if (source === "i64" && target === "i32") return "i32.wrap_i64";
    if (source === "i32" && target === "i64") {
      return isUnsignedMapleInteger(sourceMapleType) ? "i64.extend_i32_u" : "i64.extend_i32_s";
    }
    if ((source === "f32" || source === "f64") && (target === "i32" || target === "i64")) {
      const sign = isUnsignedMapleInteger(targetMapleType) ? "u" : "s";
      return `${target}.trunc_${source}_${sign}` as ConvOp;
    }
    if ((source === "i32" || source === "i64") && (target === "f32" || target === "f64")) {
      const sign = isUnsignedMapleInteger(sourceMapleType) ? "u" : "s";
      return `${target}.convert_${source}_${sign}` as ConvOp;
    }
    if (source === "f32" && target === "f64") return "f64.promote_f32";
    if (source === "f64" && target === "f32") return "f32.demote_f64";
    throw new Error(`lowering: unsupported conversion ${source} to ${target}`);
  }

  private truthy(expression: ASTExpression): Expr {
    const mapleType = resolvedType(expression);
    const type = lane(mapleType);
    const value = this.lowerExpression(expression);
    if (mapleType === "bool") return value;
    return this.fn.binop("ne", type, false, value, this.fn.constant(type, zero(type)));
  }

  private lowerIntrinsic(expression: CallExpression): Expr {
    const intrinsic = getIntrinsic(expression.func);
    if (!intrinsic || intrinsic.result === "void") return unsupported(expression);
    const args = expression.args.map((argument) => this.lowerExpression(argument));
    if (expression.func === "__load_i32") return this.fn.load("i32", args[0]!);
    if (expression.func === "__memory_size") return this.fn.memorySize();
    if (expression.func === "__memory_grow") return this.fn.memoryGrow(args[0]!);
    if (intrinsic.instruction.endsWith(".copysign")) {
      const type = intrinsic.result;
      return this.fn.binop("copysign", type, false, args[0]!, args[1]!);
    }
    const op = intrinsic.instruction.split(".")[1];
    if (
      op === "sqrt" ||
      op === "abs" ||
      op === "floor" ||
      op === "ceil" ||
      op === "nearest" ||
      op === "trunc"
    ) {
      return this.fn.unop(op, intrinsic.result, args[0]!);
    }
    return unsupported(expression);
  }

  private lowerVoidIntrinsic(expression: CallExpression): void {
    const args = expression.args.map((argument) => this.lowerExpression(argument));
    if (expression.func === "__store_i32") {
      this.fn.store("i32", args[0]!, args[1]!);
      return;
    }
    if (expression.func === "__memory_copy") {
      this.fn.memoryCopy(args[0]!, args[1]!, args[2]!);
      return;
    }
    unsupported(expression);
  }

  private callAnnotations(expression: CallExpression): {
    results: string[];
    decl: ResolvedDecl;
  } {
    const annotated = expression as ASTExpression;
    if (!annotated.resolvedCallTarget || annotated.resolvedResultTypes === undefined) {
      return missingAnnotation(expression);
    }
    if (annotated.resolvedCallTarget.kind !== "decl" || !annotated.resolvedDecl) {
      return unsupported(expression);
    }
    return { results: annotated.resolvedResultTypes, decl: annotated.resolvedDecl };
  }

  private directCallee(expression: CallExpression, declaration: ResolvedDecl): FuncId {
    if (declaration.kind !== "function") return unsupported(expression);
    const id = this.functions.get(declaration.name);
    if (id === undefined) return unsupported(expression);
    return id;
  }

  private resolveWritable(identifier: Identifier): Binding | GlobalBinding {
    resolvedType(identifier);
    const declaration = (identifier as ASTExpression).resolvedDecl;
    if (!declaration) return missingAnnotation(identifier);
    if (declaration.kind === "param") return unsupported(identifier);
    if (declaration.kind === "local") {
      const binding = this.findLocal(declaration.name);
      if (!binding) return unsupported(identifier);
      return binding;
    }
    if (declaration.kind === "global") {
      const binding = this.globals.get(declaration.name);
      if (!binding) return unsupported(identifier);
      return binding;
    }
    return unsupported(identifier);
  }

  private resolveLvalue(expression: ASTExpression): IrLvalue {
    if (expression instanceof Identifier) {
      const binding = this.resolveWritable(expression);
      return {
        mapleType: binding.mapleType,
        load: () => this.bindingGet(binding),
        store: (value) => this.bindingSet(binding, value),
      };
    }
    if (expression instanceof MemberExpression || expression instanceof PointerMemberExpression) {
      const mapleType = resolvedType(expression);
      const member = this.resolveMember(resolvedType(expression.parent), expression.member);
      const base = this.local("i32", "__member_base");
      this.fn.localSet(base, this.lowerExpression(expression.parent));
      return {
        mapleType,
        load: () =>
          this.fn.load(
            member.lane,
            this.fn.localGet(base),
            member.offset,
            member.width,
            signedLoad(member.mapleType),
          ),
        store: (value) =>
          void this.fn.store(
            member.lane,
            this.fn.localGet(base),
            value,
            member.offset,
            member.width,
          ),
      };
    }
    if (expression instanceof IndexExpression) {
      const mapleType = resolvedType(expression);
      const baseType = resolvedType(expression.left);
      resolvedType(expression.index);
      if (arrayElementType(baseType) !== mapleType) {
        throw new Error(`lowering: index annotation mismatch '${mapleType}'`);
      }
      const base = this.local("i32", "__index_base");
      const index = this.local("i32", "__index");
      const address = this.local("i32", "__index_addr");
      this.fn.localSet(base, this.lowerExpression(expression.left));
      this.fn.localSet(index, this.lowerExpression(expression.index));
      this.fn.localSet(
        address,
        this.fn.call(this.runtime.elemAddr(), [
          this.fn.localGet(base),
          this.fn.localGet(index),
          this.fn.constant("i32", sizeofType(mapleType)),
        ]),
      );
      return {
        mapleType,
        load: () =>
          this.fn.load(
            lane(mapleType),
            this.fn.localGet(address),
            0,
            widthOf(mapleType),
            signedLoad(mapleType),
          ),
        store: (value) =>
          void this.fn.store(
            lane(mapleType),
            this.fn.localGet(address),
            value,
            0,
            widthOf(mapleType),
          ),
      };
    }
    return unsupported(expression);
  }

  private bindingGet(binding: Binding | GlobalBinding): Expr {
    return "kind" in binding ? this.fn.localGet(binding.id) : this.fn.globalGet(binding.id);
  }

  private bindingSet(binding: Binding | GlobalBinding, value: Expr): void {
    if ("kind" in binding) this.fn.localSet(binding.id, value);
    else this.fn.globalSet(binding.id, value);
  }

  private findLocal(name: string): Binding | undefined {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const binding = this.scopes[index]!.get(name);
      if (binding) return binding;
    }
    return undefined;
  }

  private withControl(target: ControlTarget, build: () => void): void {
    this.controls.push(target);
    try {
      build();
    } finally {
      this.controls.pop();
    }
  }

  private findContinueTarget(): LabelId | undefined {
    for (let index = this.controls.length - 1; index >= 0; index -= 1) {
      const label = this.controls[index]!.continueLabel;
      if (label !== undefined) return label;
    }
    return undefined;
  }
}

export function lowerModule(
  ast: ASTProgram,
  meta: ModuleMeta,
  options: EmitOptions = { importMemory: false },
): LoweringResult {
  const builder = new IrBuilder();
  const layouts = new Map<string, StructLayout>();
  layouts.set(
    "string",
    structLayout({
      len: { name: "len", type: "i32" },
      data: { name: "data", type: "i32" },
    }),
  );
  for (const statement of ast.statements) {
    if (statement instanceof StructStatement) {
      layouts.set(statement.name, structLayout(statement.members));
    }
  }
  for (const [identity, definition] of Object.entries(meta.structs)) {
    if (!layouts.has(identity)) layouts.set(identity, structLayout(definition.members));
  }
  for (const [identity, layout] of layouts) builder.structLayout(identity, layout);

  const staticData = new StaticDataPlanner(builder, layouts);
  staticData.scan(ast);

  const framePlans = new Map<FunctionStatement, FramePlan>();
  for (const statement of ast.statements) {
    if (statement instanceof FunctionStatement) {
      framePlans.set(statement, planFrame(statement.fnExpr.body, layouts));
    }
  }
  const needsStack = [...framePlans.values()].some((frame) => frame.size > 0);
  const stackPointer = needsStack ? builder.global("__sp", "i32", true, 65_536) : undefined;

  const globals = new Map<string, GlobalBinding>();
  for (const statement of ast.statements) {
    if (!(statement instanceof LetStatement)) continue;
    if (statement.pattern instanceof TuplePattern) unsupported(statement);
    const name = statement.identifier.tokenLiteral();
    const type = lane(statement.typeAnnotation);
    const expression = statement.expression;
    const aggregate =
      expression instanceof StructLiteralExpression ||
      expression instanceof ArrayLiteralExpression ||
      expression instanceof StringLiteralExpression;
    const constant = expression !== null && isScalarConstant(expression);
    const init = aggregate
      ? staticData.addressOf(expression)
      : constant
        ? constantInitializer(expression, statement.typeAnnotation)
        : zero(type);
    const globalOptions = statement.exported ? { export: name } : {};
    const id = builder.global(
      name,
      type,
      expression !== null && !constant && !aggregate ? true : statement.mutable,
      init,
      globalOptions,
    );
    globals.set(name, { id, mapleType: statement.typeAnnotation });
  }

  const runtime = new RuntimeHelpers(builder, layouts);

  const functions = new Map<string, FuncId>();
  const functionBuilders = new Map<FunctionStatement, FuncBuilder>();
  for (const statement of ast.statements) {
    if (!(statement instanceof FunctionStatement)) continue;
    const params = statement.fnExpr.params.map((param) => lane(param.type));
    const results = statement.fnExpr.returnTypes.map(lane);
    const signature = builder.signature(params, results);
    const functionOptions = statement.exported ? { export: statement.name } : {};
    const fn = builder.func(statement.name, signature, functionOptions);
    functions.set(statement.name, fn.id);
    functionBuilders.set(statement, fn);
  }

  for (const statement of ast.statements) {
    if (
      statement instanceof LetStatement ||
      statement instanceof FunctionStatement ||
      statement instanceof StructStatement ||
      statement instanceof ImportStatement
    ) {
      continue;
    }
    unsupported(statement);
  }

  for (const [statement, fn] of functionBuilders) {
    const params = statement.fnExpr.params.map((param) => ({
      name: param.identifier.tokenLiteral(),
      type: param.type,
    }));
    new FunctionLowerer(
      fn,
      functions,
      globals,
      params,
      layouts,
      staticData,
      runtime,
      framePlans.get(statement),
      stackPointer,
    ).lowerBody(statement.fnExpr.body);
  }

  const deferredByOwner = new Map<string, typeof meta.deferredGlobalInits>();
  for (const initializer of meta.deferredGlobalInits) {
    if (initializer.owner === undefined) continue;
    const entries = deferredByOwner.get(initializer.owner) ?? [];
    entries.push(initializer);
    deferredByOwner.set(initializer.owner, entries);
  }
  const pendingInits: PendingInitializer[] = [];
  for (const site of staticData.pendingSites) {
    const initializer = deferredByOwner.get(site.owner)?.[site.ordinal];
    if (!initializer) {
      throw new Error(
        `lowering: missing deferred initializer for '${site.owner}' ordinal ${site.ordinal}`,
      );
    }
    if (initializer.kind !== "memory") {
      throw new Error(
        `lowering: deferred initializer kind mismatch for '${site.owner}' ordinal ${site.ordinal}`,
      );
    }
    if (initializer.id === undefined || initializer.owner === undefined) {
      throw new Error(`lowering: deferred initializer for '${site.owner}' is missing identity`);
    }
    if (!site.needsStore) {
      pendingInits.push({ initializerId: initializer.id, locals: [], statements: [] });
      continue;
    }
    const fragmentBuilder = new IrBuilder();
    const signature = fragmentBuilder.signature([], []);
    const fragment = fragmentBuilder.func("__pending_init", signature);
    const locals: IrType[] = [];
    const lowerer = new FunctionLowerer(
      fragment,
      functions,
      globals,
      [],
      layouts,
      staticData,
      runtime,
      undefined,
      undefined,
      locals,
    );
    lowerer.lowerPendingStore(
      site.baseAddr + site.member.offset,
      site.member.mapleType,
      site.expression,
    );
    pendingInits.push({
      initializerId: initializer.id,
      locals,
      statements: fragment.body,
    });
  }

  runtime.finish();
  const requiredPages = Math.max(2, Math.ceil(staticData.dataEnd / 65_536) + 1);
  const pages = Math.max(meta.memoryMinimumPages ?? 0, requiredPages);
  builder.memory(options.importMemory ? "imported" : "owned", pages);
  return { module: builder.finish(), pendingInits };
}
