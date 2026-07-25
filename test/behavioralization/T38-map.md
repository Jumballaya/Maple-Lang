# T38 String-Emitter Deletion Map

T38 removes the obsolete string-emission pipeline after T37 made
`lowerModule → printWat` the only product path. The surviving metadata,
rewriting, and reachability code is address-free; IR static-data planning is
the sole layout owner.

## Moved survivors

| Former home | T38 home | Surviving responsibility |
|---|---|---|
| `emitters/analysis/flow.ts` | `compiler/flow.ts` | `stmtDefinitelyReturns` only |
| `emitters/emit.types.ts` | `compiler/types.ts` | Checker/parser/lowering type-string and signature helpers |
| `emitters/emitter.types.ts` | `compiler/metadata.ts` | Address-free module metadata and `StructData` construction |
| `emitters/module.ts` | `compiler/module-metadata.ts` | `extractModuleMeta` and `collectFnReferences` |
| `emitters/emit.data.ts` | `compiler/data-extraction.ts` | Layout-free literal validation and startup initializer identity scan |
| `emitters/merge-model.ts` | `compiler/merge-model.ts` | Checked-AST merge model |
| `emitters/reachability.ts` | `compiler/reachability.ts` | Declaration/helper/startup reachability |
| `emitters/merge.ts` | `compiler/merge.ts` | Merged AST clone/rewrite and lowering bridge |
| Compiler-local import linking | `compiler/compiler.ts::linkModuleGraph` | Linked type identities and imported `StructData` construction |

`ModuleEmitter`, `ModuleBuilder`, `MapleModule`, `writer/`, every expression
and statement emitter, emitter runtime helpers, and all WAT assembly helpers
were deleted.

## Differential and layout freeze

| Site | T38 disposition |
|---|---|
| T30 scalar differential harness | Replaced the old-emitter oracle with the previously observed literal runtime values. |
| T31 memory differential harness | Replaced the old-emitter oracle with fixed runtime values. |
| T32 module differential harness | Replaced the old-emitter oracle with fixed cross-module/function-reference values. |
| T31 parser/layout equality | Parser offsets were replaced with literal `Mixed` and `Reverse` size/offset goldens in the IR layout test. |

These conversions landed before the emitter files were deleted.

## Legacy emitter and parser tests

| Former test | Disposition |
|---|---|
| Resolved `I_I` import emits an i64 WAT type | Deleted; imported lane behavior is covered by IR module lowering and executable import tests. |
| `emitModule` requests imported memory | Deleted; CLI memory-mode and host-surface tests cover the product option. |
| Resolved function import emits WAT import/type text | Deleted; merged compiler import execution and IR import lowering cover behavior. |
| `resolveStructMember` rejects an unsupported emitter base | Deleted; checker member diagnostics reject unsupported bases before lowering. |
| Non-literal array elements fail static extraction | Ported to call `extractModuleMeta` directly; the T39-owned rejection remains pinned. |
| Invalid void return avoids emitter temporaries | Deleted; the checker rejects the invalid program and IR frame execution is independently covered. |
| `emitExpression` rejects struct literals in value position | Deleted; annotation-totality diagnostics pin the checker rejection. |
| Parser struct offset/size assertions | Removed; name, type, and declaration order remain asserted, while layout is pinned by IR layout goldens. |
| String payload bytes in `ModuleMeta.data` | Deleted with the dead byte-payload carrier; IR data emission and tree-shaken literal execution cover the payload. |
| Emission-only load/store and compare helper units | Deleted; typed IR memory/scalar execution tests cover those operations. |
| Annotation-neutral old WAT comparison | Deleted with `emitMergedProgram`; merged-clone annotation rewriting remains asserted and product execution covers output. |

## Address-model test conversion

| Former assertion | T38 disposition |
|---|---|
| Merged segment address/alignment cursor and `dataEnd` | Deleted; `StaticDataPlanner` and IR validation own layout, sizing, and alignment. |
| Model-computed heap base and memory pages | Heap model entry now pins argument `0`; IR module tests pin rebaking from `IrModule.dataEnd`. |
| `ownedData`, allocation ids, and `dataOwners` | Deleted; these identities were derived from dead source addresses. Call, fn-ref, global, and helper edges remain asserted. |
| Memory initializer `baseAddr` mutation | Deleted; the lowering test now proves the emitted store uses its IR-planned address. |
| Memory initializer address/field/expression payload | Replaced with an exact `{kind, id, owner}` model assertion. Pending IR fragments retain the actual store work. |
