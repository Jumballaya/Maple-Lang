import { BooleanLiteralExpression } from "../parser/ast/expressions/BooleanLiteralExpression";
import { CallExpression } from "../parser/ast/expressions/CallExpression";
import { CastExpression } from "../parser/ast/expressions/CastExpression";
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
import type { ASTExpression } from "../parser/ast/types/ast.type";
import { baseScalar, cmpOps, valueTypeToWasm } from "./emitters/emit.types";
import type {
  FunctionContext,
  FunctionMeta,
  ModuleMeta,
  StructData,
  VariableMeta,
} from "./emitters/emitter.types";
import { makeLabel } from "./emitters/emitter.utils";
import { MapleModule } from "./MapleModule";
import { FuncWriter } from "./writer/FuncWriter";
import { Writer } from "./writer/Writer";
import type { IWriter } from "./writer/writer.type";

export class ModuleEmitter {
  private writers: IWriter[] = [new Writer()];

  // Code generation
  private globals: string[] = []; // global declarations, e.g. (global $xyz (mut i32) (i32.const 0))
  private data: string[] = []; // data declarations, e.g. (data (offset (i32.const 512)) "Hello World")
  private functions: string[] = []; // full (func ... ) declaration
  private signatures: string[] = []; // function signatures, e.g. (type $i_i_type (func (param i32) (result i32)))
  private imports: string[] = []; // imports, e.g. (import "env" "malloc" (func $malloc (type $i_i_type)))

  // Context
  private mod: ModuleMeta;
  private currentFn: FunctionContext | undefined = undefined;
  private labelStack: Record<"break" | "loop", string[]> = {
    break: [],
    loop: [],
  };
  private needsShadowStack = false;

  constructor(data: ModuleMeta) {
    this.mod = data;
  }

  public get writer(): IWriter {
    return this.writers[this.writers.length - 1]!;
  }

  public get ctx() {
    return {
      mod: this.mod,
      fn: this.currentFn,
      writer: this.writer,
    };
  }

  // loop labels
  public makeLabel(type: "break" | "loop"): string {
    const label = makeLabel(type);
    this.labelStack[type].push(label);
    return label;
  }

  public destroyLabel(type: "break" | "loop", name: string): void {
    const lastLabel = this.labelStack[type][this.labelStack[type].length - 1];
    if (lastLabel !== name) {
      throw new Error(`incorrect label: ${name}, expected: ${lastLabel}`);
    }
    this.labelStack[type].pop();
  }

  public getCurrentLabel(type: "break" | "loop"): string | undefined {
    return this.labelStack[type][this.labelStack[type].length - 1];
  }

  // text API
  public addImportWat(s: string) {
    this.imports.push(s);
  }
  public addSignatureWat(s: string) {
    if (!this.signatures.includes(s)) {
      this.signatures.push(s);
    }
  }
  public addGlobalWat(s: string) {
    this.globals.push(s);
  }
  public addDataWat(s: string) {
    this.data.push(s);
  }

  public build(): MapleModule {
    const globals = this.needsShadowStack
      ? ["(global $__sp (mut i32) (i32.const 65536))", ...this.globals]
      : this.globals;
    return new MapleModule(this.mod.name, {
      globals,
      data: this.data,
      functions: this.functions,
      imports: this.imports,
      signatures: this.signatures,
    });
  }

  // Add Definitions
  public defParam(meta: VariableMeta): void {
    if (!this.currentFn) {
      throw new Error("[param definition] no active function to define params for");
    }
    this.currentFn.params[meta.name] = meta;
  }
  public defLocal(meta: VariableMeta): void {
    if (!this.currentFn) {
      throw new Error("[local definition] no active function to define locals for");
    }
    this.currentFn.locals[meta.name] = meta;
  }

  public configureLocalStructFrame(totalSize: number, offsets: Record<string, number>): void {
    if (!this.currentFn) {
      throw new Error("[local struct frame] no active function");
    }
    this.currentFn.frameSize = totalSize;
    this.currentFn.structFrameOffsets = offsets;
    if (totalSize > 0) {
      this.needsShadowStack = true;
    }
  }

  //////  Misc
  public getLocals(): Record<string, VariableMeta> {
    if (!this.currentFn) {
      throw new Error("[get locals] no active function to get locals for");
    }
    return this.currentFn.locals;
  }

  public getStruct(name: string): StructData | undefined {
    return this.mod.structs[name];
  }

  public getVar(name: string): VariableMeta | undefined {
    const fn = this.currentFn;
    if (fn) {
      if (fn.locals[name]) return fn.locals[name];
      if (fn.params[name]) return fn.params[name];
    }
    return this.mod.globals[name];
  }

  public getExprType(expr: ASTExpression): "i32" | "f32" | "bool" | "void" {
    if (expr instanceof IntegerLiteralExpression) {
      return "i32";
    }
    if (expr instanceof FloatLiteralExpression) {
      return "f32";
    }
    if (expr instanceof BooleanLiteralExpression) {
      return "bool";
    }
    if (expr instanceof StringLiteralExpression) {
      return "i32";
    }
    if (expr instanceof Identifier) {
      const v = this.getVar(expr.tokenLiteral());
      if (!v) {
        throw new Error(`unknown variable: ${expr.tokenLiteral()}`);
      }
      const t = baseScalar(v.type);
      return t === "f32" ? "f32" : t === "bool" ? "bool" : "i32";
    }
    if (expr instanceof IndexExpression) {
      const meta = this.getVar(expr.left.tokenLiteral());
      const maple = meta?.type ?? "i32[]";
      const elem = baseScalar(maple);
      return elem === "f32" ? "f32" : elem === "bool" ? "bool" : "i32";
    }
    if (expr instanceof InfixExpression) {
      const lt = this.getExprType(expr.left);
      const rt = this.getExprType(expr.right);
      if (cmpOps.has(expr.operator)) {
        return "bool";
      }
      return lt === "f32" || rt === "f32" ? "f32" : "i32";
    }
    if (expr instanceof PrefixExpression) {
      if (!expr.right) {
        throw new Error(`[get expression type] prefix expression missing rhs`);
      }
      if (expr.operator === "!") {
        return "bool";
      }
      if (expr.operator === "~") {
        return "i32";
      }
      if (expr.operator === "-") {
        const t = this.getExprType(expr.right);
        return t === "f32" ? "f32" : "i32";
      }
      return "i32";
    }
    if (expr instanceof PostfixExpression) {
      if (!expr.left) {
        throw new Error(`[get expression type] postfix expression missing lhs`);
      }
      return this.getExprType(expr.left);
    }
    if (expr instanceof CallExpression) {
      const internal = this.mod.functions[expr.func];
      if (internal) {
        return internal.result;
      }
      const imp = this.mod.imports[expr.func];
      if (imp?.info && imp.info.kind === "func") {
        const retType = imp.info.signature.split("_")[1];
        if (retType === "v") {
          return "void";
        } else if (retType === "i") {
          return "i32";
        } else if (retType === "f") {
          return "f32";
        }
      }
      throw new Error(`[function call expression] unable to determine type`);
    }
    if (expr instanceof CastExpression) {
      const wt = valueTypeToWasm(expr.targetType);
      return wt === "f32" ? "f32" : "i32";
    }
    if (expr instanceof PointerMemberExpression || expr instanceof MemberExpression) {
      if (!(expr.parent instanceof Identifier)) return "i32";
      const base = expr.parent.tokenLiteral();
      const member = expr.member;
      const baseVar = this.getVar(base);
      if (!baseVar) return "i32";
      const structName = baseVar.type.startsWith("*") ? baseVar.type.slice(1) : baseVar.type;
      const memberData = this.mod.structs[structName]?.members[member];
      if (!memberData) return "i32";
      const t = baseScalar(memberData.type);
      return t === "f32" ? "f32" : t === "bool" ? "bool" : "i32";
    }

    return "i32";
  }

  public resolveBinaryOpTypes(
    left: ASTExpression,
    right: ASTExpression,
  ): ["f32", "f32"] | ["i32", "i32"] {
    const l = this.getExprType(left);
    const r = this.getExprType(right);
    if (l === "f32" || r === "f32") {
      return ["f32", "f32"];
    }
    return ["i32", "i32"];
  }

  //
  //  Creates a function Writer
  //
  public withFunction<T>(meta: FunctionMeta, emit: (w: IWriter) => T): T {
    const writer = new FuncWriter((wat) => this.functions.push(wat));
    this.pushWriter(writer);
    const currentFn = this.currentFn;
    try {
      this.currentFn = {
        name: meta.name ?? "<anon>",
        params: {},
        locals: {},
        labels: [],
        frameSize: 0,
        structFrameOffsets: {},
      };
      const out = emit(writer);
      writer.end();
      if (meta.name) {
        this.mod.functions[meta.name] = {
          params: meta.params,
          result: meta.result,
          mapleResult: meta.mapleResult,
          exported: !!meta.exported,
          signature: meta.signature,
        };
      }
      return out;
    } finally {
      this.popWriter();
      this.currentFn = currentFn;
    }
  }

  //
  //  Writers interal API
  //
  private pushWriter(w: IWriter): void {
    this.writers.push(w);
  }

  private popWriter(): IWriter {
    if (this.writers.length === 1) throw new Error("popWriter underflow");
    return this.writers.pop()!;
  }
}
