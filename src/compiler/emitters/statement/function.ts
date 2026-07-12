import type { FunctionStatement } from "../../../parser/ast/statements/FunctionStatement";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { buildLocalStructFrame, extractLocals } from "../emit.data";
import { valueTypeToWasm, wasmLaneToSignatureChar, wasmStoreOp } from "../emit.types";
import { emitExpression } from "../expression/expression";
import { emitStatement } from "./statement";

export function emitFunction(fn: FunctionStatement, emitter: ModuleEmitter): void {
  const rTypes = fn.fnExpr.returnTypes.map((t) => valueTypeToWasm(t));
  const params: Array<{ name: string; type: string }> = [];
  for (const p of fn.fnExpr.params) {
    params.push({ name: p.identifier.tokenLiteral(), type: p.type });
  }
  emitter.withFunction(
    {
      name: fn.name ?? undefined,
      params,
      results: rTypes,
      mapleResults: fn.fnExpr.returnTypes,
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
      if (rTypes.length > 0) {
        w.append(` (result ${rTypes.join(" ")})`);
      }
      w.newLine();
      w.open();
      extractLocals(fn, emitter);
      const frame = buildLocalStructFrame(fn.fnExpr.body, emitter);
      emitter.configureLocalStructFrame(frame.totalSize, frame.offsets);

      if (frame.totalSize > 0 && rTypes.length === 1) {
        emitter.defLocal({
          name: "__ret_tmp",
          type: rTypes[0]!,
          scope: "local",
        });
      }
      if (frame.totalSize > 0 && rTypes.length >= 2) {
        for (let i = 0; i < rTypes.length; i++) {
          emitter.defLocal({
            name: `__mret_${i}`,
            type: rTypes[i]!,
            scope: "local",
          });
        }
      }

      // write local definitions
      for (const v of Object.values(emitter.getLocals())) {
        w.line(`(local $${v.name} ${valueTypeToWasm(v.type)})`);
      }

      if (frame.totalSize > 0) {
        w.line(`(global.set $__sp (i32.sub (global.get $__sp) (i32.const ${frame.totalSize})))`);
        const ordered = Object.entries(frame.offsets).sort(([, a], [, b]) => a - b);
        for (const [varName, off] of ordered) {
          if (off === 0) {
            w.line(`(local.set $${varName} (global.get $__sp))`);
          } else {
            w.line(`(local.set $${varName} (i32.add (global.get $__sp) (i32.const ${off})))`);
          }
        }
      }

      const deferredInits = emitter.ctx.mod.deferredGlobalInits;
      if (fn.exported && deferredInits.length > 0) {
        w.line(`(if (i32.eqz (global.get $__globals_inited)) (then`);
        w.line(`(global.set $__globals_inited (i32.const 1))`);
        for (const init of deferredInits) {
          const val = emitExpression(init.expr, emitter);
          if (init.kind === "global") {
            w.line(`(global.set $${init.name} ${val})`);
          } else {
            const storeOp = wasmStoreOp(init.fieldType);
            w.line(`(${storeOp} (i32.const ${init.baseAddr + init.offset}) ${val})`);
          }
        }
        w.line(`))`);
      }

      // write body
      for (const s of fn.fnExpr.body.statements) {
        emitStatement(s, emitter);
      }

      if (frame.totalSize > 0) {
        w.line(`(global.set $__sp (i32.add (global.get $__sp) (i32.const ${frame.totalSize})))`);
      }

      // close
      w.close(")");
      w.line();
    },
  );
}

// returns: [params, results, typeName]
// ['void', 'void', $v_v_type] or [['i32'], ['i32'], $i_i_type]
type WasmParam = "i32" | "f32" | "i64" | "f64";

function signatureCharToWasm(c: string): WasmParam | null {
  if (c === "i") return "i32";
  if (c === "I") return "i64";
  if (c === "f") return "f32";
  if (c === "F") return "f64";
  return null;
}

export function extractFunctionSignature(
  signature: string,
): [WasmParam[] | "void", WasmParam[] | "void", string] {
  const typeName = `$${signature}_type`;
  const paramStr = signature.split("_")[0] ?? "";
  const resultStr = signature.split("_")[1] ?? "";

  let p: WasmParam[] | "void" = "void";
  if (paramStr.length > 0 && paramStr !== "v") {
    p = [];
    for (const param of paramStr.split("")) {
      const w = signatureCharToWasm(param);
      if (w) p.push(w);
    }
  }

  let r: WasmParam[] | "void" = "void";
  if (resultStr.length > 0 && resultStr !== "v") {
    r = [];
    for (const res of resultStr.split("")) {
      const w = signatureCharToWasm(res);
      if (w) r.push(w);
    }
  }

  return [p, r, typeName];
}

//   (type $i_i_type (func (param i32) (result i32)))
export function emitFunctionSignature(
  typeName: string,
  params: WasmParam[] | "void",
  result: WasmParam[] | "void",
): string {
  let func = `(func`;
  const paramList = params === "void" ? [] : params;
  for (const p of paramList) {
    func += ` (param ${p})`;
  }

  let resultLine = " (result";
  let count = 0;
  const resultList = result === "void" ? [] : result;
  for (const p of resultList) {
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
    signature += wasmLaneToSignatureChar(valueTypeToWasm(p.type));
  }
  if (signature === "") {
    signature = "v";
  }
  signature += "_";

  if (fn.fnExpr.returnTypes.length === 0) {
    signature += "v";
  } else {
    for (const returnType of fn.fnExpr.returnTypes) {
      signature += wasmLaneToSignatureChar(valueTypeToWasm(returnType));
    }
  }

  return signature;
}
