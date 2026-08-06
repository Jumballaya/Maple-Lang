import type { FuncBuilder, IrBuilder } from "./build";
import type { Expr, FuncId, IrType, Sig, SigId, StructLayout, StructLayoutMember } from "./ir";

function isStringMember(member: StructLayoutMember): boolean {
  return member.mapleType === "string" || member.memberIdentity === "string";
}

function isSignedNarrow(member: StructLayoutMember): boolean {
  return member.mapleType === "i8" || member.mapleType === "i16";
}

function memberLoad(fn: FuncBuilder, member: StructLayoutMember, base: Expr): Expr {
  return fn.load(
    member.lane,
    base,
    member.offset,
    member.width,
    member.width === undefined ? undefined : isSignedNarrow(member),
  );
}

export function elemAddr(builder: IrBuilder): FuncId {
  const sig = builder.signature(["i32", "i32", "i32"], ["i32"]);
  const fn = builder.func("__elem_addr", sig);
  fn.nameLocal(0, "len_addr");
  fn.nameLocal(1, "index");
  fn.nameLocal(2, "elem_size");
  const length = fn.load("i32", fn.localGet(0));
  fn.if(fn.binop("ge", "i32", false, fn.localGet(1), length), (body) => {
    body.unreachable();
  });
  const data = fn.load("i32", fn.localGet(0), 4);
  const offset = fn.binop("mul", "i32", false, fn.localGet(1), fn.localGet(2));
  fn.ret([fn.binop("add", "i32", false, data, offset)]);
  return fn.id;
}

export function stringEq(builder: IrBuilder): FuncId {
  const sig = builder.signature(["i32", "i32"], ["i32"]);
  const fn = builder.func("__string_eq", sig);
  fn.nameLocal(0, "a");
  fn.nameLocal(1, "b");
  const length = fn.local("i32", "len");
  const index = fn.local("i32", "index");

  fn.localSet(length, fn.load("i32", fn.localGet(0)));
  fn.if(
    fn.binop("ne", "i32", false, fn.localGet(length), fn.load("i32", fn.localGet(1))),
    (body) => {
      body.ret([body.constant("i32", 0)]);
    },
  );
  fn.localSet(0, fn.load("i32", fn.localGet(0), 4));
  fn.localSet(1, fn.load("i32", fn.localGet(1), 4));
  fn.localSet(index, fn.constant("i32", 0));
  fn.block((done, block) => {
    block.loop((scan, loop) => {
      loop.brIf(done, loop.binop("ge", "i32", false, loop.localGet(index), loop.localGet(length)));
      const leftAddress = loop.binop("add", "i32", false, loop.localGet(0), loop.localGet(index));
      const rightAddress = loop.binop("add", "i32", false, loop.localGet(1), loop.localGet(index));
      const leftByte = loop.load("i32", leftAddress, 0, 8, false);
      const rightByte = loop.load("i32", rightAddress, 0, 8, false);
      loop.if(loop.binop("ne", "i32", false, leftByte, rightByte), (body) => {
        body.ret([body.constant("i32", 0)]);
      });
      loop.localSet(
        index,
        loop.binop("add", "i32", false, loop.localGet(index), loop.constant("i32", 1)),
      );
      loop.br(scan);
    });
  });
  fn.ret([fn.constant("i32", 1)]);
  return fn.id;
}

export function structEqBatch(
  builder: IrBuilder,
  layouts: Map<string, StructLayout>,
  stringEqId?: FuncId,
): Map<string, FuncId> {
  for (const [identity, layout] of layouts) {
    for (const member of layout.members) {
      if (isStringMember(member)) {
        if (stringEqId === undefined) {
          throw new Error(`stringEqId is required for struct '${identity}'`);
        }
      } else if (member.memberIdentity !== undefined && !layouts.has(member.memberIdentity)) {
        throw new Error(
          `member identity '${member.memberIdentity}' is outside the struct equality batch`,
        );
      }
    }
  }
  for (const [identity, layout] of layouts) builder.structLayout(identity, layout);

  const sig = builder.signature(["i32", "i32"], ["i32"]);
  const builders = new Map<string, FuncBuilder>();
  const ids = new Map<string, FuncId>();
  for (const identity of layouts.keys()) {
    const fn = builder.func(`__struct_eq_${identity}`, sig);
    fn.nameLocal(0, "a");
    fn.nameLocal(1, "b");
    builders.set(identity, fn);
    ids.set(identity, fn.id);
  }

  for (const [identity, layout] of layouts) {
    const fn = builders.get(identity)!;
    // Address 0 does not trap (it is in the shadow-stack page), so without
    // this a self-referential struct recurses forever even with `0 as T` ends.
    fn.if(
      fn.binop(
        "or",
        "i32",
        false,
        fn.unop("eqz", "i32", fn.localGet(0)),
        fn.unop("eqz", "i32", fn.localGet(1)),
      ),
      (body) => {
        body.ret([body.binop("eq", "i32", false, body.localGet(0), body.localGet(1))]);
      },
    );
    for (const member of layout.members) {
      const left = memberLoad(fn, member, fn.localGet(0));
      const right = memberLoad(fn, member, fn.localGet(1));
      let notEqual: Expr;
      if (isStringMember(member)) {
        const equal = fn.call(stringEqId!, [left, right]);
        notEqual = fn.unop("eqz", "i32", equal);
      } else if (member.memberIdentity !== undefined) {
        const equal = fn.call(ids.get(member.memberIdentity)!, [left, right]);
        notEqual = fn.unop("eqz", "i32", equal);
      } else if (member.lane === "f32" || member.lane === "f64") {
        const equal = fn.binop("eq", member.lane, false, left, right);
        notEqual = fn.unop("eqz", "i32", equal);
      } else {
        notEqual = fn.binop("ne", member.lane, false, left, right);
      }
      fn.if(notEqual, (body) => {
        body.ret([body.constant("i32", 0)]);
      });
    }
    fn.ret([fn.constant("i32", 1)]);
  }
  return ids;
}

export function trampoline(
  builder: IrBuilder,
  target: FuncId,
  targetSig: SigId | Sig,
  name = `__indirect_${target}`,
): FuncId {
  const targetShape = typeof targetSig === "number" ? builder.getSignature(targetSig) : targetSig;
  const sig = builder.signature(["i32", ...targetShape.params], targetShape.results);
  const fn = builder.func(name, sig);
  fn.nameLocal(0, "env");
  const args = targetShape.params.map((_, index) => fn.localGet(index + 1));
  if (targetShape.results.length === 0) {
    fn.callVoid(target, args);
  } else if (targetShape.results.length === 1) {
    fn.ret([fn.call(target, args)]);
  } else {
    const targets = targetShape.results.map((type: IrType) => fn.local(type));
    fn.multiCall({ kind: "func", fn: target }, args, targets);
    fn.ret(targets.map((local) => fn.localGet(local)));
  }
  return fn.id;
}
