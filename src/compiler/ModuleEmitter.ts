import { ASTExpression } from "../parser/ast/types/ast.type.js";
import type {
  FunctionContext,
  FunctionMeta,
  ModuleMeta,
  StructData,
  VariableMeta,
} from "./emitters/emitter.types.js";
import { baseScalar, cmpOps } from "./emitters/emit.types.js";
import { MapleModule } from "./MapleModule.js";
import { FuncWriter } from "./writer/FuncWriter.js";
import { Writer } from "./writer/Writer.js";
import type { IWriter } from "./writer/writer.type.js";

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
    return new MapleModule(this.mod.name, {
      globals: this.globals,
      data: this.data,
      functions: this.functions,
      imports: this.imports,
      signatures: this.signatures,
    });
  }

  // Add Definitions
  public defParam(meta: VariableMeta): void {
    if (!this.currentFn) {
      throw new Error(
        "[param definition] no active function to define params for"
      );
    }
    this.currentFn.params[meta.name] = meta;
  }
  public defLocal(meta: VariableMeta): void {
    if (!this.currentFn) {
      throw new Error(
        "[local definition] no active function to define locals for"
      );
    }
    this.currentFn.locals[meta.name] = meta;
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
    switch (expr.type) {
      case "integer_literal": {
        return "i32";
      }
      case "float_literal": {
        return "f32";
      }
      case "bool_literal": {
        return "bool";
      }
      case "identifier": {
        const v = this.getVar(expr.value);
        if (!v) {
          throw new Error(`unknown variable: ${expr.value}`);
        }
        const t = baseScalar(v.type);
        return t === "f32" ? "f32" : t === "bool" ? "bool" : "i32";
      }
      case "index": {
        const meta = this.getVar(expr.identifier);
        const maple = meta?.type ?? "i32[]";
        const elem = baseScalar(maple);
        return elem === "f32" ? "f32" : elem === "bool" ? "bool" : "i32";
      }
      case "binary": {
        const lt = this.getExprType(expr.left);
        const rt = this.getExprType(expr.right);
        if (cmpOps.has(expr.op)) {
          return "bool";
        }
        return lt === "f32" || rt === "f32" ? "f32" : "i32";
      }
      case "prefix": {
        throw new Error(
          `[get expression type] prefix expression not implemented`
        );
      }
      case "postfix": {
        throw new Error(
          `[get expression type] postfix expression not implemented`
        );
      }
      case "function_call": {
        const internal = this.mod.functions[expr.function];
        if (internal) {
          return internal.result;
        }
        const imp = this.mod.imports[expr.function];
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
      case "pointer_member":
      case "member": {
        throw new Error(
          `[get expression type] member/pointer member expression not implemented`
        );
      }

      default: {
        return "i32";
      }
    }
  }

  public resolveBinaryOpTypes(
    left: ASTExpression,
    right: ASTExpression
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
      };
      const out = emit(writer);
      writer.end();
      if (meta.name) {
        this.mod.functions[meta.name] = {
          params: meta.params,
          result: meta.result,
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
