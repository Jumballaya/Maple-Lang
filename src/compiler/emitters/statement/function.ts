import { FunctionStatement } from "../../../parser/ast/statements/FunctionStatement.js";
import type { ModuleEmitter } from "../../ModuleEmitter.js";
import { extractLocals } from "../emit.data.js";
import { valueTypeToWasm } from "../emit.types.js";
import { emitStatement } from "./statement.js";

export function emitFunction(
  fn: FunctionStatement,
  emitter: ModuleEmitter
): void {
  const rType = fn.fnExpr.returnType
    ? valueTypeToWasm(fn.fnExpr.returnType)
    : "void";
  const params: Array<{ name: string; type: string }> = [];
  for (const p of fn.fnExpr.params) {
    params.push({ name: p.identifier.tokenLiteral(), type: p.type });
  }
  emitter.withFunction(
    {
      name: fn.name ?? undefined,
      params,
      result: rType,
      exported: !!fn.exported,
      signature: generateFunctionSignature(fn),
    },
    () => {
      const w = emitter.writer;

      // define params
      for (const p of fn.fnExpr.params) {
        const name = p.identifier.tokenLiteral();
        const type = p.type;
        emitter.defParam({ name, type, scope: "param" });
        params.push({ name, type });
      }

      // start writing func
      w.append("(func");
      if (fn.name) {
        const exported = fn.exported;
        w.append(` $${fn.name}${exported ? ` (export "${fn.name}")` : ""}`);
      }

      // write params
      for (const p of fn.fnExpr.params) {
        const n = p.identifier.tokenLiteral();
        const t = p.type;
        w.append(` (param $${n} ${valueTypeToWasm(t)})`);
      }

      // write return result
      if (fn.fnExpr.returnType) {
        w.append(` (result ${valueTypeToWasm(fn.fnExpr.returnType)})`);
      }
      w.newLine();
      w.open();
      extractLocals(fn, emitter);

      // write local definitions
      for (const v of Object.values(emitter.getLocals())) {
        w.line(`(local $${v.name} ${valueTypeToWasm(v.type)})`);
      }

      // write body
      for (const s of fn.fnExpr.body.statements) {
        emitStatement(s, emitter);
      }

      // close
      w.close(")");
      w.line();
    }
  );
}

// returns: [params, results, typeName]
// ['void', 'void', $v_v_type] or [['i32'], ['i32'], $i_i_type]
export function extractFunctionSignature(
  signature: string
): [Array<"i32" | "f32"> | "void", Array<"i32" | "f32"> | "void", string] {
  const typeName = `$${signature}_type`;
  const params = signature.split("_")[0]?.split("") ?? [];
  const results = signature.split("_")[1]?.split("") ?? [];

  let p: Array<"i32" | "f32"> | "void" = "void";
  if (params.length > 0) {
    p = [];
    for (const param of params) {
      if (param === "i") {
        p.push("i32");
      } else if (param === "f") {
        p.push("f32");
      }
    }
  }

  let r: Array<"i32" | "f32"> | "void" = "void";
  if (results.length > 0) {
    r = [];
    for (const res of results) {
      if (res === "i") {
        r.push("i32");
      } else if (res === "f") {
        r.push("f32");
      }
    }
  }

  return [p, r, typeName];
}

//   (type $i_i_type (func (param i32) (result i32)))
export function emitFunctionSignature(
  typeName: string,
  params: ("i32" | "f32")[] | "void",
  result: ("i32" | "f32")[] | "void"
): string {
  let func = `(func`;
  for (const p of params) {
    func += ` (param ${p})`;
  }

  let resultLine = " (result";
  let count = 0;
  for (const p of result) {
    resultLine += ` ${p}`;
    count++;
  }
  resultLine += ")";
  if (count > 0) {
    func += resultLine;
  }
  func += ")";
  return `(type ${typeName} ${func})`;
}

//
//  function signature in the following format:
//
//      [params,]_[return]
//
//      f32 -> f | i32 -> i | void -> v
//
//      (): void              --> v_v
//      (i32, f32): void      --> if_v
//      (): f32               --> v_f
//      (): i32               --> v_i
//      (i32, f32, i32): i32  --> ifi_i
//
//        etc. etc. etc.
//
export function generateFunctionSignature(fn: FunctionStatement): string {
  let signature = "";
  for (const p of fn.fnExpr.params) {
    signature += valueTypeToWasm(p.type).slice(0, 1);
  }
  if (signature === "") {
    signature = "v";
  }
  signature += "_";

  const rType = fn.fnExpr.returnType
    ? valueTypeToWasm(fn.fnExpr.returnType)
    : "void";
  signature += `${rType.slice(0, 1)}`;

  return signature;
}
