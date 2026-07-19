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
} from "./ir";

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

class FunctionLowerer {
  private readonly scopes: Array<Map<string, Binding>> = [];
  private readonly controls: ControlTarget[] = [];

  constructor(
    private readonly fn: FuncBuilder,
    private readonly functions: Map<string, FuncId>,
    private readonly globals: Map<string, GlobalBinding>,
    params: Array<{ name: string; type: string }>,
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
    this.lowerBlock(block);
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
    const localType = lane(statement.typeAnnotation);
    const id = this.fn.local(localType, statement.resolvedName ?? name);
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
      const id = this.fn.local(lane(resultType), localName);
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
          this.fn.local(lane(type), `__return_${index}`),
        );
        this.fn.multiCall(
          { kind: "func", fn: this.directCallee(callExpression, call.decl) },
          callExpression.args.map((argument) => this.lowerExpression(argument)),
          targets,
        );
        this.fn.ret(targets.map((target) => this.fn.localGet(target)));
        return;
      }
    }
    this.fn.ret(statement.returnValues.map((value) => this.lowerExpression(value)));
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
    if (!(expression.left instanceof Identifier) || expression.value === null) {
      unsupported(expression);
    }
    const binding = this.resolveWritable(expression.left);
    let value: Expr;
    const operator = COMPOUND_OPERATORS[expression.operator];
    if (operator === undefined) {
      value = this.lowerExpression(expression.value);
    } else {
      value = this.lowerBinaryOperands(
        operator,
        binding.mapleType,
        () => this.bindingGet(binding),
        () => this.lowerExpression(expression.value!),
      );
    }
    this.bindingSet(binding, value);
  }

  private lowerPostfixStatement(expression: PostfixExpression): void {
    if (!(expression.left instanceof Identifier)) unsupported(expression);
    const binding = this.resolveWritable(expression.left);
    const type = lane(binding.mapleType);
    const operator = expression.operator === "++" ? "add" : "sub";
    const value = this.fn.binop(
      operator,
      type,
      !isUnsignedMapleInteger(binding.mapleType),
      this.bindingGet(binding),
      this.fn.constant(type, one(type)),
    );
    this.bindingSet(binding, value);
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
    const selector = this.fn.local("i32", "__switch");
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
      expression instanceof StringLiteralExpression ||
      expression instanceof IndexExpression ||
      expression instanceof MemberExpression ||
      expression instanceof PointerMemberExpression
    ) {
      return unsupported(expression);
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
      const leftLocal = this.fn.local(type, "__rem_left");
      const rightLocal = this.fn.local(type, "__rem_right");
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
    const old = this.fn.local(type, "__postfix_old");
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
  const pages = meta.memoryMinimumPages ?? Math.max(2, Math.ceil(meta.dataPtr / 65_536) + 1);
  builder.memory(options.importMemory ? "imported" : "owned", pages);

  const globals = new Map<string, GlobalBinding>();
  for (const statement of ast.statements) {
    if (!(statement instanceof LetStatement)) continue;
    if (statement.pattern instanceof TuplePattern) unsupported(statement);
    const name = statement.identifier.tokenLiteral();
    const type = lane(statement.typeAnnotation);
    const expression = statement.expression;
    if (
      expression instanceof StructLiteralExpression ||
      expression instanceof ArrayLiteralExpression ||
      expression instanceof StringLiteralExpression
    ) {
      unsupported(expression);
    }
    const constant = expression !== null && isScalarConstant(expression);
    const init = constant ? constantInitializer(expression, statement.typeAnnotation) : zero(type);
    const globalOptions = statement.exported ? { export: name } : {};
    const id = builder.global(
      name,
      type,
      expression !== null && !constant ? true : statement.mutable,
      init,
      globalOptions,
    );
    globals.set(name, { id, mapleType: statement.typeAnnotation });
  }

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
    new FunctionLowerer(fn, functions, globals, params).lowerBody(statement.fnExpr.body);
  }

  return { module: builder.finish(), pendingInits: [] };
}
