import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type FuncBuilder, IrBuilder } from "../src/ir/build";
import { encodeWasm } from "../src/ir/encode-wasm";
import type { IrModule, Stmt, StructLayout } from "../src/ir/ir";
import { elemAddr, stringEq, structEqBatch, trampoline } from "../src/ir/runtime";
import { runExport } from "./helpers";

function instantiate(module: IrModule, imports: WebAssembly.Imports = {}): WebAssembly.Instance {
  const bytes = encodeWasm(module) as Uint8Array<ArrayBuffer>;
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), imports);
}

function bytes(size: number, write: (view: DataView) => void): Uint8Array {
  const result = new Uint8Array(size);
  write(new DataView(result.buffer));
  return result;
}

function header(length: number, pointer: number): Uint8Array {
  return bytes(8, (view) => {
    view.setUint32(0, length, true);
    view.setUint32(4, pointer, true);
  });
}

function exportedBinaryWrapper(builder: IrBuilder, helper: number, name = "equal"): FuncBuilder {
  const sig = builder.signature(["i32", "i32"], ["i32"]);
  const wrapper = builder.func(name, sig, { export: name });
  wrapper.ret([wrapper.call(helper, [wrapper.localGet(0), wrapper.localGet(1)])]);
  return wrapper;
}

describe("IR builder", () => {
  test("finish rejects dangling labels and bad call arity", () => {
    const dangling = new IrBuilder();
    const voidSig = dangling.signature([], []);
    const fn = dangling.func("dangling", voidSig);
    fn.emit({ k: "br", label: 99 } as Stmt);
    assert.throws(() => dangling.finish(), /branch target label 99 is not enclosing/);

    const badCall = new IrBuilder();
    const calleeSig = badCall.signature(["i32"], []);
    const callee = badCall.func("callee", calleeSig);
    const callerSig = badCall.signature([], []);
    const caller = badCall.func("caller", callerSig);
    caller.callVoid(callee.id, []);
    assert.throws(() => badCall.finish(), /call argument count must match signature/);
  });

  test("imports must precede definitions", () => {
    const builder = new IrBuilder();
    const sig = builder.signature([], []);
    builder.func("defined", sig);
    assert.throws(
      () => builder.funcImport("env", "late", sig),
      /imports must be declared before definitions/,
    );
    assert.throws(
      () => builder.globalImport("env", "late", "i32"),
      /imports must be declared before definitions/,
    );
  });

  test("allocates shared import and definition index spaces", () => {
    const builder = new IrBuilder();
    const unary = builder.signature(["i32"], ["i32"]);
    const voidSig = builder.signature([], []);
    const inc = builder.funcImport("env", "inc", unary);
    const double = builder.funcImport("env", "double", unary);
    const firstGlobal = builder.globalImport("env", "left", "i32");
    const secondGlobal = builder.globalImport("env", "right", "i32");
    assert.deepEqual([inc, double, firstGlobal, secondGlobal], [0, 1, 0, 1]);

    const run = builder.func("run", unary, { export: "run" });
    run.ret([run.call(double, [run.call(inc, [run.localGet(0)])])]);
    const spare = builder.func("spare", voidSig);
    const firstDefinedGlobal = builder.global("first", "i32", false, 3);
    const secondDefinedGlobal = builder.global("second", "i32", true, 4);
    assert.deepEqual([run.id, spare.id, firstDefinedGlobal, secondDefinedGlobal], [2, 3, 2, 3]);

    const instance = instantiate(builder.finish(), {
      env: {
        inc: (value: number) => value + 1,
        double: (value: number) => value * 2,
        left: 10,
        right: 20,
      },
    });
    assert.equal((instance.exports.run as (value: number) => number)(4), 10);
  });
});

describe("IR runtime: elemAddr", () => {
  test("computes in-range addresses and traps every unsigned overrun", () => {
    const builder = new IrBuilder();
    builder.memory("owned", 2);
    const arrayHeader = 65_536;
    const data = 65_600;
    builder.data(arrayHeader, header(3, data));
    const helper = elemAddr(builder);
    const runSig = builder.signature(["i32"], ["i32"]);
    const run = builder.func("address", runSig, { export: "address" });
    run.ret([
      run.call(helper, [run.constant("i32", arrayHeader), run.localGet(0), run.constant("i32", 4)]),
    ]);
    const module = builder.finish();
    assert.equal(runExport(module, "address", [2]), data + 8);
    assert.throws(() => runExport(module, "address", [3]), WebAssembly.RuntimeError);
    assert.throws(() => runExport(module, "address", [-1]), WebAssembly.RuntimeError);
  });
});

describe("IR runtime: stringEq", () => {
  test("compares lengths and UTF-8 payload bytes", () => {
    const builder = new IrBuilder();
    builder.memory("owned", 2);
    const headers = [65_536, 65_544, 65_552, 65_560, 65_568, 65_576];
    const payloads = [65_600, 65_610, 65_620, 65_630];
    builder.data(headers[0]!, header(3, payloads[0]!));
    builder.data(headers[1]!, header(3, payloads[1]!));
    builder.data(headers[2]!, header(3, payloads[2]!));
    builder.data(headers[3]!, header(2, payloads[3]!));
    builder.data(headers[4]!, header(0, 0));
    builder.data(headers[5]!, header(0, 0));
    builder.data(payloads[0]!, new Uint8Array([0x61, 0x62, 0x63]));
    builder.data(payloads[1]!, new Uint8Array([0x61, 0x62, 0x63]));
    builder.data(payloads[2]!, new Uint8Array([0x61, 0x78, 0x63]));
    builder.data(payloads[3]!, new Uint8Array([0x61, 0x62]));
    const helper = stringEq(builder);
    exportedBinaryWrapper(builder, helper);
    const module = builder.finish();
    assert.equal(runExport(module, "equal", [headers[0]!, headers[1]!]), 1);
    assert.equal(runExport(module, "equal", [headers[0]!, headers[2]!]), 0);
    assert.equal(runExport(module, "equal", [headers[0]!, headers[3]!]), 0);
    assert.equal(runExport(module, "equal", [headers[4]!, headers[5]!]), 1);
  });
});

describe("IR runtime: structEqBatch", () => {
  test("compares declared numeric widths while skipping padding", () => {
    const builder = new IrBuilder();
    builder.memory("owned", 2);
    const layout: StructLayout = {
      size: 12,
      align: 4,
      members: [
        { name: "wide", offset: 0, mapleType: "i32", lane: "i32" },
        { name: "narrow", offset: 8, mapleType: "i16", lane: "i32", width: 16 },
      ],
    };
    const addresses = [65_536, 65_552, 65_568];
    builder.data(
      addresses[0]!,
      bytes(12, (view) => {
        view.setInt32(0, 7, true);
        view.setUint32(4, 0x1111_1111, true);
        view.setInt16(8, -9, true);
      }),
    );
    builder.data(
      addresses[1]!,
      bytes(12, (view) => {
        view.setInt32(0, 7, true);
        view.setUint32(4, 0xeeee_eeee, true);
        view.setInt16(8, -9, true);
      }),
    );
    builder.data(
      addresses[2]!,
      bytes(12, (view) => {
        view.setInt32(0, 7, true);
        view.setInt16(8, 10, true);
      }),
    );
    const ids = structEqBatch(builder, new Map([["Packed", layout]]));
    exportedBinaryWrapper(builder, ids.get("Packed")!);
    const module = builder.finish();
    assert.equal(runExport(module, "equal", [addresses[0]!, addresses[1]!]), 1);
    assert.equal(runExport(module, "equal", [addresses[0]!, addresses[2]!]), 0);
  });

  test("delegates string members to content equality", () => {
    const builder = new IrBuilder();
    builder.memory("owned", 2);
    const firstHeader = 65_536;
    const secondHeader = 65_544;
    const firstPayload = 65_600;
    const secondPayload = 65_610;
    const firstStruct = 65_620;
    const secondStruct = 65_624;
    builder.data(firstHeader, header(3, firstPayload));
    builder.data(secondHeader, header(3, secondPayload));
    builder.data(firstPayload, new Uint8Array([1, 2, 3]));
    builder.data(secondPayload, new Uint8Array([1, 2, 3]));
    builder.data(
      firstStruct,
      bytes(4, (view) => view.setUint32(0, firstHeader, true)),
    );
    builder.data(
      secondStruct,
      bytes(4, (view) => view.setUint32(0, secondHeader, true)),
    );
    const layout: StructLayout = {
      size: 4,
      align: 4,
      members: [
        {
          name: "text",
          offset: 0,
          mapleType: "string",
          lane: "i32",
          memberIdentity: "string",
        },
      ],
    };
    const strings = stringEq(builder);
    const ids = structEqBatch(builder, new Map([["Named", layout]]), strings);
    exportedBinaryWrapper(builder, ids.get("Named")!);
    assert.equal(runExport(builder.finish(), "equal", [firstStruct, secondStruct]), 1);
  });

  test("reserves mutually recursive helpers before filling their bodies", () => {
    const builder = new IrBuilder();
    builder.memory("owned", 2);
    const aLayout: StructLayout = {
      size: 8,
      align: 4,
      members: [
        { name: "tag", offset: 0, mapleType: "i32", lane: "i32" },
        { name: "b", offset: 4, mapleType: "B", lane: "i32", memberIdentity: "B" },
      ],
    };
    const bLayout: StructLayout = {
      size: 8,
      align: 4,
      members: [
        { name: "tag", offset: 0, mapleType: "i32", lane: "i32" },
        { name: "a", offset: 4, mapleType: "A", lane: "i32", memberIdentity: "A" },
      ],
    };
    const [a1, b1, a2, b2] = [65_536, 65_544, 65_552, 65_560];
    builder.data(
      a1,
      bytes(8, (view) => {
        view.setInt32(0, 1, true);
        view.setUint32(4, b1, true);
      }),
    );
    builder.data(
      b1,
      bytes(8, (view) => {
        view.setInt32(0, 1, true);
        view.setUint32(4, a1, true);
      }),
    );
    builder.data(
      a2,
      bytes(8, (view) => {
        view.setInt32(0, 2, true);
        view.setUint32(4, b2, true);
      }),
    );
    builder.data(
      b2,
      bytes(8, (view) => {
        view.setInt32(0, 2, true);
        view.setUint32(4, a2, true);
      }),
    );
    const ids = structEqBatch(
      builder,
      new Map([
        ["A", aLayout],
        ["B", bLayout],
      ]),
    );
    exportedBinaryWrapper(builder, ids.get("A")!);
    assert.equal(runExport(builder.finish(), "equal", [a1, a2]), 0);
  });

  test("rejects missing string helpers and identities outside the batch", () => {
    const stringLayout: StructLayout = {
      size: 4,
      align: 4,
      members: [
        { name: "s", offset: 0, mapleType: "string", lane: "i32", memberIdentity: "string" },
      ],
    };
    assert.throws(
      () => structEqBatch(new IrBuilder(), new Map([["S", stringLayout]])),
      /stringEqId is required/,
    );

    const externalLayout: StructLayout = {
      size: 4,
      align: 4,
      members: [
        { name: "other", offset: 0, mapleType: "Other", lane: "i32", memberIdentity: "Other" },
      ],
    };
    assert.throws(
      () => structEqBatch(new IrBuilder(), new Map([["S", externalLayout]])),
      /member identity 'Other' is outside the struct equality batch/,
    );
  });

  test("uses float equality so NaN is unequal to itself", () => {
    const builder = new IrBuilder();
    builder.memory("owned", 2);
    const address = 65_536;
    builder.data(
      address,
      bytes(8, (view) => view.setFloat64(0, Number.NaN, true)),
    );
    const layout: StructLayout = {
      size: 8,
      align: 8,
      members: [{ name: "value", offset: 0, mapleType: "f64", lane: "f64" }],
    };
    const ids = structEqBatch(builder, new Map([["FloatBox", layout]]));
    exportedBinaryWrapper(builder, ids.get("FloatBox")!);
    assert.equal(runExport(builder.finish(), "equal", [address, address]), 0);
  });
});

describe("IR runtime: trampoline", () => {
  test("drops junk env values for void, one-result, and multi-result targets", () => {
    const builder = new IrBuilder();
    const status = builder.global("status", "i32", true, 0);
    const voidTargetSig = builder.signature(["i32"], []);
    const oneTargetSig = builder.signature(["i32", "i32"], ["i32"]);
    const multiTargetSig = builder.signature(["i32"], ["i32", "i64"]);

    const voidTarget = builder.func("void_target", voidTargetSig);
    voidTarget.globalSet(status, voidTarget.localGet(0));
    const oneTarget = builder.func("one_target", oneTargetSig);
    oneTarget.ret([
      oneTarget.binop("add", "i32", true, oneTarget.localGet(0), oneTarget.localGet(1)),
    ]);
    const multiTarget = builder.func("multi_target", multiTargetSig);
    multiTarget.ret([
      multiTarget.localGet(0),
      multiTarget.convert("i64.extend_i32_s", multiTarget.localGet(0)),
    ]);

    const voidTrampoline = trampoline(builder, voidTarget.id, voidTargetSig);
    const oneTrampoline = trampoline(builder, oneTarget.id, oneTargetSig);
    const multiTrampoline = trampoline(builder, multiTarget.id, multiTargetSig);
    const voidSlot = builder.tableEntry(voidTrampoline);
    const oneSlot = builder.tableEntry(oneTrampoline);
    const multiSlot = builder.tableEntry(multiTrampoline);

    const voidCallSig = builder.signature(["i32", "i32"], []);
    const oneCallSig = builder.signature(["i32", "i32", "i32"], ["i32"]);
    const multiCallSig = builder.signature(["i32", "i32"], ["i32", "i64"]);

    const runVoidSig = builder.signature(["i32"], ["i32"]);
    const runVoid = builder.func("run_void", runVoidSig, { export: "run_void" });
    runVoid.callIndirectVoid(voidCallSig, runVoid.constant("i32", voidSlot), [
      runVoid.constant("i32", 0x1234),
      runVoid.localGet(0),
    ]);
    runVoid.ret([runVoid.globalGet(status)]);

    const runOne = builder.func("run_one", oneTargetSig, { export: "run_one" });
    runOne.ret([
      runOne.callIndirect(oneCallSig, runOne.constant("i32", oneSlot), [
        runOne.constant("i32", 0x5678),
        runOne.localGet(0),
        runOne.localGet(1),
      ]),
    ]);

    const runMulti = builder.func("run_multi", multiTargetSig, { export: "run_multi" });
    const first = runMulti.local("i32");
    const second = runMulti.local("i64");
    runMulti.multiCall(
      { kind: "indirect", sig: multiCallSig, index: runMulti.constant("i32", multiSlot) },
      [runMulti.constant("i32", 0x9abc), runMulti.localGet(0)],
      [first, second],
    );
    runMulti.ret([runMulti.localGet(first), runMulti.localGet(second)]);

    const module = builder.finish();
    assert.equal(runExport(module, "run_void", [41]), 41);
    assert.equal(runExport(module, "run_one", [20, 22]), 42);
    assert.deepEqual(runExport(module, "run_multi", [7]), [7, 7n]);
  });
});
