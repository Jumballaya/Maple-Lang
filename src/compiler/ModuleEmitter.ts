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
import {
  baseScalar,
  cmpOps,
  isUnsignedMapleInteger,
  valueTypeToWasm,
  type WasmValueType,
} from "./emitters/emit.types";
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
  private tables: string[] = []; // table declarations, e.g. (table $__fn_table N N funcref)
  private elem: string[] = []; // elem segments, e.g. (elem (i32.const 0) func $__indirect_foo ...)

  // Context
  private mod: ModuleMeta;
  private currentFn: FunctionContext | undefined = undefined;
  private labelStack: Record<"break" | "loop" | "continue", string[]> = {
    break: [],
    loop: [],
    continue: [],
  };
  private needsShadowStack = false;

  // Runtime helpers emitted once per module, only when something uses them.
  public needsArrayRuntime = false;
  public needsStringEq = false;
  public readonly structEqNames = new Set<string>();

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
  public makeLabel(type: "break" | "loop" | "continue"): string {
    const label = makeLabel(type);
    this.labelStack[type].push(label);
    return label;
  }

  public destroyLabel(type: "break" | "loop" | "continue", name: string): void {
    const lastLabel = this.labelStack[type][this.labelStack[type].length - 1];
    if (lastLabel !== name) {
      throw new Error(`incorrect label: ${name}, expected: ${lastLabel}`);
    }
    this.labelStack[type].pop();
  }

  public getCurrentLabel(type: "break" | "loop" | "continue"): string | undefined {
    return this.labelStack[type][this.labelStack[type].length - 1];
  }

  // For `while`, the loop label IS the continue target (jumping to the loop
  // top re-checks the condition). Push the existing loop label onto the
  // continue stack instead of allocating a new one.
  public pushContinueAlias(label: string): void {
    this.labelStack.continue.push(label);
  }

  public popContinueAlias(label: string): void {
    const top = this.labelStack.continue[this.labelStack.continue.length - 1];
    if (top !== label) {
      throw new Error(`continue alias mismatch: expected ${label}, got ${top}`);
    }
    this.labelStack.continue.pop();
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
  public addTableWat(s: string): void {
    this.tables.push(s);
  }
  public addElemWat(s: string): void {
    this.elem.push(s);
  }
  public addFunctionWat(s: string): void {
    this.functions.push(s);
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
      tables: this.tables,
      elem: this.elem,
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

  // `@` is valid in WAT identifiers but not Maple ones, so suffixed names
  // (`x@1`) can never collide with user code.
  public uniqueLocalName(src: string): string {
    const fn = this.currentFn;
    if (!fn) {
      throw new Error("[unique local] no active function");
    }
    if (!fn.params[src] && !fn.locals[src]) return src;
    for (let i = 1; ; i++) {
      const candidate = `${src}@${i}`;
      if (!fn.params[candidate] && !fn.locals[candidate]) return candidate;
    }
  }

  public pushScope(): void {
    this.currentFn?.scopes.push(new Map());
  }
  public popScope(): void {
    this.currentFn?.scopes.pop();
  }
  public bindLocal(srcName: string, uniqueName: string): void {
    const scopes = this.currentFn?.scopes;
    if (!scopes || scopes.length === 0) return;
    scopes[scopes.length - 1]!.set(srcName, uniqueName);
  }
  private resolveLocalName(srcName: string): string | undefined {
    const scopes = this.currentFn?.scopes;
    if (!scopes) return undefined;
    for (let i = scopes.length - 1; i >= 0; i--) {
      const hit = scopes[i]!.get(srcName);
      if (hit !== undefined) return hit;
    }
    return undefined;
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
      const scoped = this.resolveLocalName(name);
      if (scoped && fn.locals[scoped]) return fn.locals[scoped];
      if (fn.locals[name]) return fn.locals[name];
      if (fn.params[name]) return fn.params[name];
    }
    const gl = this.mod.globals[name];
    if (gl) {
      return gl;
    }
    const imp = this.mod.imports[name];
    if (imp?.info?.kind === "global") {
      return { name, scope: "global", type: imp.info.type };
    }
    return undefined;
  }

  public getCallReturnTypes(funcName: string): WasmValueType[] | null {
    const internal = this.mod.functions[funcName];
    if (internal) {
      return internal.results;
    }

    const imp = this.mod.imports[funcName];
    if (imp?.info && imp.info.kind === "func") {
      const ret = imp.info.signature.split("_")[1] ?? "";
      if (ret === "v") return [];
      const out: WasmValueType[] = [];
      for (const ch of ret) {
        if (ch === "i") out.push("i32");
        if (ch === "I") out.push("i64");
        if (ch === "f") out.push("f32");
        if (ch === "F") out.push("f64");
      }
      return out;
    }

    return null;
  }

  public getExprType(expr: ASTExpression): string | null {
    if (expr instanceof IntegerLiteralExpression) {
      return expr.numericType === "i64" ? "i64" : "i32";
    }
    if (expr instanceof FloatLiteralExpression) {
      return expr.numericType === "f64" ? "f64" : "f32";
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
      if (t === "f32" || t === "f64" || t === "bool") return t;
      if (t === "u8" || t === "u16" || t === "u32" || t === "u64") return t;
      if (t === "i8" || t === "i16" || t === "i32" || t === "i64") return t;
      return "i32";
    }
    if (expr instanceof IndexExpression) {
      const meta = this.getVar(expr.left.tokenLiteral());
      const maple = meta?.type ?? "i32[]";
      const elem = baseScalar(maple);
      if (elem === "f32" || elem === "f64" || elem === "bool") return elem;
      if (elem === "u8" || elem === "u16" || elem === "u32" || elem === "u64") return elem;
      if (elem === "i8" || elem === "i16" || elem === "i32" || elem === "i64") return elem;
      return "i32";
    }
    if (expr instanceof InfixExpression) {
      const lt = this.getExprType(expr.left);
      const rt = this.getExprType(expr.right);
      if (lt === null || rt === null) return "i32";
      if (cmpOps.has(expr.operator)) {
        return "bool";
      }
      if (expr.operator === "<<" || expr.operator === ">>") return lt;
      const wl = valueTypeToWasm(lt);
      const wr = valueTypeToWasm(rt);
      if (wl === "f32" || wl === "f64" || wr === "f32" || wr === "f64") {
        if (wl === "f64" || wr === "f64") return "f64";
        return "f32";
      }
      if (wl === "i64" || wr === "i64") {
        if (wl !== wr) {
          return isUnsignedMapleInteger(wl === "i64" ? lt : rt) ? "u64" : "i64";
        }
        if (isUnsignedMapleInteger(lt) || isUnsignedMapleInteger(rt)) return "u64";
        return "i64";
      }
      if (isUnsignedMapleInteger(lt) || isUnsignedMapleInteger(rt)) return "u32";
      return "i32";
    }
    if (expr instanceof PrefixExpression) {
      if (!expr.right) {
        throw new Error(`[get expression type] prefix expression missing rhs`);
      }
      if (expr.operator === "!") {
        return "bool";
      }
      if (expr.operator === "~") {
        return this.getExprType(expr.right);
      }
      if (expr.operator === "-") {
        return this.getExprType(expr.right);
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
        if (internal.results.length === 0) return "void";
        if (internal.results.length > 1) return null;
        const firstMaple = baseScalar(internal.mapleResults[0] ?? "i32");
        if (
          firstMaple === "f32" ||
          firstMaple === "f64" ||
          firstMaple === "i64" ||
          firstMaple === "u64" ||
          firstMaple === "u32" ||
          firstMaple === "u16" ||
          firstMaple === "u8" ||
          firstMaple === "i32" ||
          firstMaple === "i16" ||
          firstMaple === "i8"
        ) {
          return firstMaple;
        }
        return internal.results[0] ?? null;
      }
      const imp = this.mod.imports[expr.func];
      if (imp?.info && imp.info.kind === "func") {
        const retType = imp.info.signature.split("_")[1] ?? "";
        const ch = retType[0];
        if (ch === "v" || retType === "v") {
          return "void";
        }
        if (ch === "i") return "i32";
        if (ch === "I") return "i64";
        if (ch === "f") return "f32";
        if (ch === "F") return "f64";
        if (retType.length > 1) return null;
      }
      return null;
    }
    if (expr instanceof CastExpression) {
      const b = baseScalar(expr.targetType);
      if (b === "f64" || b === "f32") return b;
      if (b === "i64" || b === "u64") return b;
      if (b === "u32" || b === "u16" || b === "u8") return b;
      if (b === "i32" || b === "i16" || b === "i8") return b;
      const wt = valueTypeToWasm(expr.targetType);
      return wt === "f32" ? "f32" : wt === "f64" ? "f64" : wt === "i64" ? "i64" : "i32";
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
      if (t === "f32" || t === "f64" || t === "bool") return t;
      if (t === "u8" || t === "u16" || t === "u32" || t === "u64") return t;
      if (t === "i8" || t === "i16" || t === "i32" || t === "i64") return t;
      return "i32";
    }

    return "i32";
  }

  public resolveBinaryOpTypes(
    left: ASTExpression,
    right: ASTExpression,
    operator?: string,
  ): [WasmValueType, WasmValueType, boolean] {
    const lt = this.getExprType(left);
    const rt = this.getExprType(right);
    if (lt === null || rt === null) {
      throw new Error("Internal: unable to resolve binary operand type");
    }
    const wl = valueTypeToWasm(lt);
    const wr = valueTypeToWasm(rt);
    if (operator === "<<" || operator === ">>") {
      return [wl, wl, !isUnsignedMapleInteger(lt)];
    }
    if (wl === "f32" || wl === "f64" || wr === "f32" || wr === "f64") {
      const w: WasmValueType = wl === "f64" || wr === "f64" ? "f64" : "f32";
      return [w, w, true];
    }
    // When one side is i64 and the other is i32 (typical for integer literals
    // mixed with an i64 binding), widen to i64 so emitOperand can extend the
    // i32 operand. The signedness follows the i64 side.
    if (wl === "i64" || wr === "i64") {
      const i64Side = wl === "i64" ? lt : rt;
      const signed = !isUnsignedMapleInteger(i64Side);
      return ["i64", "i64", signed];
    }
    if (wl !== wr) {
      throw new Error(`Internal: incompatible binary operand lanes ${wl} vs ${wr}`);
    }
    const signed = !(isUnsignedMapleInteger(lt) || isUnsignedMapleInteger(rt));
    return [wl, wr, signed];
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
        scopes: [new Map()],
      };
      const out = emit(writer);
      writer.end();
      if (meta.name) {
        this.mod.functions[meta.name] = {
          params: meta.params,
          results: meta.results,
          mapleResults: meta.mapleResults,
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
