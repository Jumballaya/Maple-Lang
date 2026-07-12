import type { ModuleEmitter } from "../ModuleEmitter";
import { wasmLoadOp } from "./emit.types";

// Runtime helpers, each emitted once per module and only when body emission
// flagged a use (needsArrayRuntime / needsStringEq / structEqNames).

// The unsigned compare makes negative indices trap along with overruns.
const ELEM_ADDR = `(func $__elem_addr (param $hdr i32) (param $idx i32) (param $size i32) (result i32)
  (if (i32.ge_u (local.get $idx) (i32.load (local.get $hdr)))
    (then (unreachable)))
  (i32.add (i32.load offset=4 (local.get $hdr))
    (i32.mul (local.get $idx) (local.get $size))))`;

const STRING_EQ = `(func $__string_eq (param $a i32) (param $b i32) (result i32)
  (local $len i32)
  (local $i i32)
  (if (i32.eq (local.get $a) (local.get $b))
    (then (return (i32.const 1))))
  (local.set $len (i32.load (local.get $a)))
  (if (i32.ne (local.get $len) (i32.load (local.get $b)))
    (then (return (i32.const 0))))
  (local.set $a (i32.load offset=4 (local.get $a)))
  (local.set $b (i32.load offset=4 (local.get $b)))
  (local.set $i (i32.const 0))
  (block $done
    (loop $scan
      (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
      (if (i32.ne (i32.load8_u (i32.add (local.get $a) (local.get $i)))
                  (i32.load8_u (i32.add (local.get $b) (local.get $i))))
        (then (return (i32.const 0))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $scan)))
  (i32.const 1))`;

export function emitRuntimeHelpers(emitter: ModuleEmitter): void {
  if (emitter.needsArrayRuntime) {
    emitter.addFunctionWat(ELEM_ADDR);
  }

  // the queue grows as generated helpers require nested-field helpers
  const generated = new Set<string>();
  const queue = [...emitter.structEqNames];
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (generated.has(name)) continue;
    generated.add(name);
    emitter.addFunctionWat(structEqWat(name, emitter, queue));
  }

  if (emitter.needsStringEq) {
    emitter.addFunctionWat(STRING_EQ);
  }
}

function structEqWat(name: string, emitter: ModuleEmitter, needsStructEq: string[]): string {
  const sd = emitter.getStruct(name);
  if (!sd) {
    throw new Error(`[struct equality] unknown struct: "${name}"`);
  }

  const lines: string[] = [];
  lines.push(`(func $__struct_eq_${name} (param $a i32) (param $b i32) (result i32)`);
  for (const m of Object.values(sd.members).sort((x, y) => x.offset - y.offset)) {
    const loadOp = wasmLoadOp(m.type === "string" ? "i32" : m.type);
    const la = `(${loadOp} offset=${m.offset} (local.get $a))`;
    const lb = `(${loadOp} offset=${m.offset} (local.get $b))`;
    let notEqual: string;
    if (m.type === "string") {
      emitter.needsStringEq = true;
      notEqual = `(i32.eqz (call $__string_eq ${la} ${lb}))`;
    } else if (emitter.getStruct(m.type)) {
      needsStructEq.push(m.type);
      notEqual = `(i32.eqz (call $__struct_eq_${m.type} ${la} ${lb}))`;
    } else if (loadOp.startsWith("f32")) {
      notEqual = `(i32.eqz (f32.eq ${la} ${lb}))`;
    } else if (loadOp.startsWith("f64")) {
      notEqual = `(i32.eqz (f64.eq ${la} ${lb}))`;
    } else if (loadOp.startsWith("i64")) {
      notEqual = `(i64.ne ${la} ${lb})`;
    } else {
      notEqual = `(i32.ne ${la} ${lb})`;
    }
    lines.push(`  (if ${notEqual} (then (return (i32.const 0))))`);
  }
  lines.push("  (i32.const 1))");
  return lines.join("\n");
}
