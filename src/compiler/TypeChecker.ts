import type { ASTProgram } from "../parser/ast/ASTProgram";
import { ArrayLiteralExpression } from "../parser/ast/expressions/ArrayLiteralExpression";
import { AssignmentExpression } from "../parser/ast/expressions/AssignmentExpression";
import { BooleanLiteralExpression } from "../parser/ast/expressions/BooleanLiteralExpression";
import { CallExpression } from "../parser/ast/expressions/CallExpression";
import { CastExpression } from "../parser/ast/expressions/CastExpression";
import { FloatLiteralExpression } from "../parser/ast/expressions/FloatLiteralExpression";
import { FunctionLiteralExpression } from "../parser/ast/expressions/FunctionLiteralExpression";
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
import { DeferStatement } from "../parser/ast/statements/DeferStatement";
import { ExpressionStatement } from "../parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../parser/ast/statements/ForStatement";
import { FunctionStatement } from "../parser/ast/statements/FunctionStatement";
import { IfStatement } from "../parser/ast/statements/IfStatement";
import { LetStatement } from "../parser/ast/statements/LetStatement";
import { ReturnStatement } from "../parser/ast/statements/ReturnStatement";
import { StructStatement } from "../parser/ast/statements/StructStatement";
import { SwitchStatement } from "../parser/ast/statements/SwitchStatement";
import { TuplePattern } from "../parser/ast/statements/TuplePattern";
import { WhileStatement } from "../parser/ast/statements/WhileStatement";
import type {
  ASTExpression,
  ASTStatement,
  ResolvedCallTarget,
  ResolvedDecl,
} from "../parser/ast/types/ast.type";
import { MapleError } from "./errors";
import { analyzeEscapes, type EscapeViolation } from "./escape";
import { stmtDefinitelyReturns } from "./flow";
import { getIntrinsic } from "./intrinsics";
import type { ModuleMeta, StructData } from "./metadata";
import {
  baseScalar,
  canonicalFnType,
  cmpOps,
  isFnType,
  isUnsignedMapleInteger,
  parseFnType,
  valueTypeToWasm,
} from "./types";

const ARITHMETIC_OPS = new Set(["+", "-", "*", "/", "%"]);
const BITWISE_OPS = new Set(["&", "|", "^", "<<", ">>"]);
const ORDERING_OPS = new Set(["<", "<=", ">", ">="]);
const SIGN_MIXING_OPS = new Set([...ARITHMETIC_OPS, "&", "|", "^", ...ORDERING_OPS]);
const SAME_LANE_OPS = new Set([...ARITHMETIC_OPS, ...cmpOps]);
const LITERAL_ADOPTION_OPS = new Set([...ARITHMETIC_OPS, ...BITWISE_OPS]);
const INTEGER_TYPES = new Set(["i8", "u8", "i16", "u16", "i32", "u32", "i64", "u64"]);
const NUMERIC_TYPES = new Set([...INTEGER_TYPES, "f32", "f64", "bool"]);
const I32_LANE_INDEX_TYPES = new Set(["i8", "u8", "i16", "u16", "i32", "u32", "bool"]);
const BUILTIN_TYPES = new Set([...NUMERIC_TYPES, "bool", "string"]);

// ─── Scope ────────────────────────────────────────────────────────────────────

type ScopeEntry = {
  type: string;
  mutable: boolean;
  kind: Exclude<ResolvedDecl["kind"], "intrinsic">;
};
type Scope = Map<string, ScopeEntry>;

type ExpressionPosition = "value" | "effect" | "multi";

function resolveTypeIdentity(type: string, meta: ModuleMeta): string {
  if (type.startsWith("*")) return `*${resolveTypeIdentity(type.slice(1), meta)}`;
  if (type.endsWith("[]")) return `${resolveTypeIdentity(type.slice(0, -2), meta)}[]`;
  const fnType = parseFnType(type);
  if (fnType) {
    return canonicalFnType(
      fnType.params.map((entry) => resolveTypeIdentity(entry, meta)),
      fnType.results.map((entry) => resolveTypeIdentity(entry, meta)),
    );
  }
  return meta.imports[type]?.typeIdentity ?? type;
}

// `string` gets a SYNTHESIZED struct entry so `s.len` resolves, so "has a
// struct definition" is not the same question as "is a struct type".
function isStructType(type: string, meta: ModuleMeta): boolean {
  if (type === "string" || type.endsWith("[]") || isFnType(type)) return false;
  return structDefinition(type, meta) !== undefined;
}

function structDefinition(type: string, meta: ModuleMeta): StructData | undefined {
  const direct = meta.structs[type];
  if (direct) return direct;
  return Object.values(meta.imports).find((entry) => entry.typeIdentity === type)?.structMeta;
}

function isKnownType(type: string, meta: ModuleMeta, allowVoid = false): boolean {
  if (type === "void") return allowVoid;
  if (BUILTIN_TYPES.has(type)) return true;
  if (type.startsWith("*")) return isKnownType(type.slice(1), meta);
  if (type.endsWith("[]")) return isKnownType(type.slice(0, -2), meta);
  const fnType = parseFnType(type);
  if (fnType) {
    return (
      fnType.params.every((entry) => isKnownType(entry, meta)) &&
      fnType.results.every((entry) => isKnownType(entry, meta, true))
    );
  }
  if (meta.structs[type]) return true;
  const imported = meta.imports[type];
  if (imported?.info?.kind === "struct") return true;
  return Object.values(meta.imports).some((entry) => entry.typeIdentity === type);
}

function firstUnknownType(type: string, meta: ModuleMeta, allowVoid = false): string | null {
  if (type === "void") return allowVoid ? null : type;
  if (BUILTIN_TYPES.has(type)) return null;
  if (type.startsWith("*")) return firstUnknownType(type.slice(1), meta);
  if (type.endsWith("[]")) return firstUnknownType(type.slice(0, -2), meta);
  const fnType = parseFnType(type);
  if (fnType) {
    for (const param of fnType.params) {
      const unknown = firstUnknownType(param, meta);
      if (unknown) return unknown;
    }
    for (const result of fnType.results) {
      const unknown = firstUnknownType(result, meta, true);
      if (unknown) return unknown;
    }
    return null;
  }
  return isKnownType(type, meta, allowVoid) ? null : type;
}

function checkKnownType(
  type: string,
  token: ASTExpression["token"],
  meta: ModuleMeta,
  errors: MapleError[],
  allowVoid = false,
): void {
  const unknown = type === "" ? null : firstUnknownType(type, meta, allowVoid);
  if (unknown) {
    errors.push(new MapleError(`unknown type '${unknown}'`, token.line, token.col));
  }
}

function fnTypeResults(type: string): string[] | null {
  const parsed = parseFnType(type);
  if (!parsed) return null;
  if (parsed.results.length === 1 && parsed.results[0] === "void") return [];
  return parsed.results;
}

function getCallReturnTypes(meta: ModuleMeta, fnName: string, scope?: Scope): string[] | null {
  const intrinsic = getIntrinsic(fnName);
  if (intrinsic) return intrinsic.result === "void" ? [] : [intrinsic.result];

  if (scope) {
    const entry = scope.get(fnName);
    if (entry && isFnType(entry.type)) {
      return fnTypeResults(entry.type);
    }
  }

  const fn = meta.functions[fnName];
  if (fn) return fn.mapleResults;

  const imp = meta.imports[fnName];
  if (imp?.info?.kind === "func") {
    if (imp.mapleResults) return imp.mapleResults;
    const resultChars = imp.info.signature.split("_")[1] ?? "";
    if (resultChars === "v") return [];
    const out: string[] = [];
    for (const ch of resultChars) {
      if (ch === "i") out.push("i32");
      if (ch === "I") out.push("i64");
      if (ch === "f") out.push("f32");
      if (ch === "F") out.push("f64");
    }
    return out;
  }

  return null;
}

type CallResolution = {
  params: string[];
  results: string[];
  target: ResolvedCallTarget;
  decl?: ResolvedDecl;
  argumentOffset: 0 | 1;
  kind: "function" | "indirect" | "intrinsic";
};

function resolveFieldCall(
  expr: CallExpression,
  scope: Scope,
  meta: ModuleMeta,
): CallResolution | null {
  const receiver = expr.args[0];
  if (!(receiver instanceof Identifier)) return null;
  const receiverType = scope.get(receiver.tokenLiteral())?.type;
  if (!receiverType) return null;
  const sourceIdentity = receiverType.startsWith("*") ? receiverType.slice(1) : receiverType;
  const expectedPrefix = `${sourceIdentity}_`;
  if (!expr.func.startsWith(expectedPrefix)) return null;
  const member = expr.func.slice(expectedPrefix.length);
  const structIdentity = resolveTypeIdentity(sourceIdentity, meta);
  const fieldType = structDefinition(structIdentity, meta)?.members[member]?.type;
  if (!fieldType || !isFnType(fieldType)) return null;
  const fnType = resolveTypeIdentity(fieldType, meta);
  const parsed = parseFnType(fnType);
  if (!parsed) return null;
  return {
    params: parsed.params,
    results: fnTypeResults(fnType) ?? [],
    target: {
      kind: "field",
      receiverArg: 0,
      structIdentity,
      member,
      fnType,
    },
    argumentOffset: 1,
    kind: "indirect",
  };
}

function resolveCall(
  expr: CallExpression,
  scope: Scope,
  meta: ModuleMeta,
): CallResolution | "not-callable" | null {
  const intrinsic = getIntrinsic(expr.func);
  if (intrinsic) {
    return {
      params: [...intrinsic.params],
      results: intrinsic.result === "void" ? [] : [intrinsic.result],
      target: { kind: "decl" },
      decl: { kind: "intrinsic", name: expr.func },
      argumentOffset: 0,
      kind: "intrinsic",
    };
  }

  const lexical = scope.get(expr.func);
  if (lexical && lexical.kind !== "function") {
    if (!isFnType(lexical.type)) return "not-callable";
    const parsed = parseFnType(resolveTypeIdentity(lexical.type, meta));
    if (!parsed) return "not-callable";
    return {
      params: parsed.params,
      results: fnTypeResults(lexical.type) ?? [],
      target: { kind: "decl" },
      decl: { kind: lexical.kind, name: expr.func },
      argumentOffset: 0,
      kind: "indirect",
    };
  }

  const field = resolveFieldCall(expr, scope, meta);
  if (field) return field;

  const fn = meta.functions[expr.func];
  if (fn) {
    return {
      params: fn.params.map((param) => resolveTypeIdentity(param.type, meta)),
      results: fn.mapleResults.map((result) => resolveTypeIdentity(result, meta)),
      target: { kind: "decl" },
      decl: { kind: "function", name: expr.func },
      argumentOffset: 0,
      kind: "function",
    };
  }

  if (lexical && isFnType(lexical.type)) {
    const parsed = parseFnType(resolveTypeIdentity(lexical.type, meta));
    if (parsed) {
      return {
        params: parsed.params,
        results: fnTypeResults(lexical.type) ?? [],
        target: { kind: "decl" },
        decl: { kind: lexical.kind, name: expr.func },
        argumentOffset: 0,
        kind: lexical.kind === "function" ? "function" : "indirect",
      };
    }
  }

  const imported = meta.imports[expr.func];
  if (imported?.info?.kind === "func") {
    const params = imported.mapleParams ?? signatureTypes(imported.info.signature, 0);
    const results = imported.mapleResults ?? signatureTypes(imported.info.signature, 1);
    return {
      params: params.map((type) => resolveTypeIdentity(type, meta)),
      results: results.map((type) => resolveTypeIdentity(type, meta)),
      target: { kind: "decl" },
      decl: { kind: "import", name: expr.func },
      argumentOffset: 0,
      kind: "function",
    };
  }

  return null;
}

function signatureTypes(signature: string, part: 0 | 1): string[] {
  const chars = signature.split("_")[part] ?? "";
  if (chars === "v") return [];
  return Array.from(chars).flatMap((char) => {
    if (char === "i") return ["i32"];
    if (char === "I") return ["i64"];
    if (char === "f") return ["f32"];
    if (char === "F") return ["f64"];
    return [];
  });
}

// ─── Expression type resolver ─────────────────────────────────────────────────
//
// Returns the Maple-level type string (e.g. "i32", "f32", "bool", "Point",
// "i32[]") or null when the type cannot be statically determined.  Returning
// null means "skip this check" — the emitter will surface the error later.

function resolveExprType(
  expr: ASTExpression,
  scope: Scope,
  meta: ModuleMeta,
  _errors?: MapleError[],
): string | null {
  if (expr.resolvedType !== undefined) return expr.resolvedType;
  if (expr instanceof IntegerLiteralExpression) {
    return expr.numericType === "i64" ? "i64" : "i32";
  }
  if (expr instanceof FloatLiteralExpression) {
    return expr.numericType === "f64" ? "f64" : "f32";
  }
  if (expr instanceof BooleanLiteralExpression) return "bool";
  if (expr instanceof StringLiteralExpression) return "string";
  if (expr instanceof ArrayLiteralExpression) {
    return `${resolveTypeIdentity(expr.memberType, meta)}[]`;
  }

  if (expr instanceof Identifier) {
    const id = expr.tokenLiteral();
    const intrinsic = getIntrinsic(id);
    if (intrinsic) {
      return canonicalFnType([...intrinsic.params], [intrinsic.result]);
    }
    const imp = meta.imports[id];
    if (imp?.info?.kind === "global") {
      return resolveTypeIdentity(imp.mapleType ?? imp.info.type, meta);
    }
    if (imp?.info?.kind === "func" && imp.mergeable && imp.mapleParams && imp.mapleResults) {
      return canonicalFnType(
        imp.mapleParams.map((type) => resolveTypeIdentity(type, meta)),
        (imp.mapleResults.length === 0 ? ["void"] : imp.mapleResults).map((type) =>
          resolveTypeIdentity(type, meta),
        ),
      );
    }
    const scoped = scope.get(id)?.type;
    return scoped ? resolveTypeIdentity(scoped, meta) : null;
  }

  if (expr instanceof CastExpression) {
    return resolveTypeIdentity(expr.targetType, meta);
  }

  if (expr instanceof InfixExpression) {
    if (cmpOps.has(expr.operator)) return "bool";
    const lt = resolveExprType(expr.left, scope, meta, _errors);
    const rt = resolveExprType(expr.right, scope, meta, _errors);
    if (lt === null || rt === null) return null;
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
    if (expr.operator === "!") return "bool";
    if (expr.operator === "~") {
      return expr.right ? resolveExprType(expr.right, scope, meta, _errors) : "i32";
    }
    if (expr.operator === "-") {
      return expr.right ? resolveExprType(expr.right, scope, meta, _errors) : "i32";
    }
    return "i32";
  }

  if (expr instanceof PostfixExpression) {
    return expr.left ? resolveExprType(expr.left, scope, meta, _errors) : "i32";
  }

  if (expr instanceof CallExpression) {
    const returnTypes =
      (expr as ASTExpression).resolvedResultTypes ?? getCallReturnTypes(meta, expr.func, scope);
    if (!returnTypes) return null;
    if (returnTypes.length === 0) return "void";
    if (returnTypes.length === 1) {
      const result = returnTypes[0];
      return result ? resolveTypeIdentity(result, meta) : null;
    }
    return null;
  }

  if (expr instanceof IndexExpression) {
    const containerType = resolveExprType(expr.left, scope, meta, _errors);
    if (!containerType) return null;
    if (!(containerType.endsWith("[]") || containerType.startsWith("*"))) return null;
    return baseScalar(containerType);
  }

  if (expr instanceof MemberExpression || expr instanceof PointerMemberExpression) {
    const parentType = resolveExprType(expr.parent, scope, meta, _errors);
    if (!parentType) return null;
    // Arrays expose the same {len, data} header members as strings.
    if (parentType.endsWith("[]")) {
      return expr.member === "len" || expr.member === "data" ? "i32" : null;
    }
    const structName = parentType.startsWith("*") ? parentType.slice(1) : parentType;
    const memberData = structDefinition(structName, meta)?.members[expr.member];
    return memberData ? resolveTypeIdentity(memberData.type, meta) : null;
  }

  if (expr instanceof AssignmentExpression) {
    return resolveExprType(expr.left, scope, meta, _errors);
  }
  if (expr instanceof StructLiteralExpression) {
    return resolveTypeIdentity(expr.name, meta);
  }

  if (expr instanceof FunctionLiteralExpression) {
    const paramTypes = expr.params.map((p) => resolveTypeIdentity(p.type, meta));
    const results =
      expr.returnTypes.length === 0
        ? ["void"]
        : expr.returnTypes.map((type) => resolveTypeIdentity(type, meta));
    return canonicalFnType(paramTypes, results);
  }

  return null;
}

// ─── Type compatibility ───────────────────────────────────────────────────────
//
// Returns true when a value of `actual` can be stored in a slot declared as
// `declared`.  Rules (in order):
//   1. Identical strings -> compatible
//   2. Either is a known struct -> must be identical (already handled by rule 1)
//   3. Either ends with [] -> must be identical
//   4. WASM-level comparison: valueTypeToWasm(declared) === valueTypeToWasm(actual)
//      This lets bool/u8/i32 all be compatible with each other.

function typesCompatible(declared: string, actual: string, meta: ModuleMeta): boolean {
  declared = resolveTypeIdentity(declared, meta);
  actual = resolveTypeIdentity(actual, meta);
  if (declared === actual) return true;
  if (isFnType(declared) && isFnType(actual)) return declared === actual;
  if (isFnType(declared) || isFnType(actual)) return false;
  if (declared === "void" || actual === "void") return false;
  if (declared === "string" || actual === "string") return false;
  if (
    structDefinition(declared, meta) ||
    structDefinition(actual, meta) ||
    declared.includes("$$") ||
    actual.includes("$$")
  ) {
    return false;
  }
  if (declared.endsWith("[]") || actual.endsWith("[]")) return false;
  return valueTypeToWasm(declared) === valueTypeToWasm(actual);
}

function integerRange(type: string | undefined): { min: bigint; max: bigint } | null {
  const match = type?.match(/^([iu])(8|16|32|64)$/);
  if (!match) return null;
  const bits = BigInt(match[2]!);
  if (match[1] === "u") return { min: 0n, max: (1n << bits) - 1n };
  const limit = 1n << (bits - 1n);
  return { min: -limit, max: limit - 1n };
}

function checkIntegerLiteralRange(
  expr: IntegerLiteralExpression,
  expectedType: string,
  errors: MapleError[],
): void {
  const range = integerRange(expectedType);
  if (!range) return;
  expr.numericType = expectedType.endsWith("64") ? "i64" : "i32";
  if (expr.bigValue < range.min || expr.bigValue > range.max) {
    errors.push(
      new MapleError(
        `integer literal out of range for type '${expectedType}'`,
        expr.token.line,
        expr.token.col,
      ),
    );
  }
}

function isLiteralIntegerTree(expr: ASTExpression): boolean {
  if (expr instanceof IntegerLiteralExpression) return true;
  return (
    expr instanceof InfixExpression &&
    LITERAL_ADOPTION_OPS.has(expr.operator) &&
    isLiteralIntegerTree(expr.left) &&
    isLiteralIntegerTree(expr.right)
  );
}

function adoptedOperandTypes(
  left: ASTExpression,
  right: ASTExpression,
  leftType: string,
  rightType: string,
): [string, string] {
  if (isLiteralIntegerTree(left) && isUnsignedMapleInteger(rightType)) {
    return [rightType, rightType];
  }
  if (isLiteralIntegerTree(right) && isUnsignedMapleInteger(leftType)) {
    return [leftType, leftType];
  }
  return [leftType, rightType];
}

function mixedSignedness(leftType: string, rightType: string): boolean {
  const left = leftType.match(/^([iu])(8|16|32|64)$/);
  const right = rightType.match(/^([iu])(8|16|32|64)$/);
  return left !== null && right !== null && left[2] === right[2] && left[1] !== right[1];
}

function checkMixedSignedness(
  leftType: string,
  rightType: string,
  token: ASTExpression["token"],
  errors: MapleError[],
): void {
  if (!mixedSignedness(leftType, rightType)) return;
  errors.push(
    new MapleError(
      `mixed signedness: '${leftType}' and '${rightType}' - cast one operand explicitly`,
      token.line,
      token.col,
    ),
  );
}

function resolveIdentifier(
  expr: Identifier,
  scope: Scope,
  meta: ModuleMeta,
): { type: string; decl: ResolvedDecl } | null {
  const name = expr.tokenLiteral();
  const imported = meta.imports[name];
  if (imported?.info?.kind === "global") {
    return {
      type: resolveTypeIdentity(imported.mapleType ?? imported.info.type, meta),
      decl: { kind: "import", name },
    };
  }
  if (
    imported?.info?.kind === "func" &&
    imported.mergeable &&
    imported.mapleParams &&
    imported.mapleResults
  ) {
    return {
      type: canonicalFnType(
        imported.mapleParams.map((type) => resolveTypeIdentity(type, meta)),
        (imported.mapleResults.length === 0 ? ["void"] : imported.mapleResults).map((type) =>
          resolveTypeIdentity(type, meta),
        ),
      ),
      decl: { kind: "import", name },
    };
  }
  const entry = scope.get(name);
  if (!entry) return null;
  return {
    type: resolveTypeIdentity(entry.type, meta),
    decl: { kind: entry.kind, name },
  };
}

function stampExpression(
  expr: ASTExpression,
  scope: Scope,
  meta: ModuleMeta,
  expectedType: string | undefined,
  position: ExpressionPosition,
): void {
  if (expr instanceof AssignmentExpression) {
    delete (expr as ASTExpression).resolvedType;
    return;
  }
  if (expr instanceof PostfixExpression && position === "effect") {
    delete (expr as ASTExpression).resolvedType;
    return;
  }
  if (expr instanceof CallExpression) return;

  let resolved: string | null;
  const contextualType = expectedType ? resolveTypeIdentity(expectedType, meta) : undefined;
  if (expr instanceof IntegerLiteralExpression && integerRange(contextualType)) {
    resolved = contextualType ?? null;
  } else if (
    expr instanceof FloatLiteralExpression &&
    (contextualType === "f32" || contextualType === "f64")
  ) {
    resolved = contextualType;
  } else {
    resolved = resolveExprType(expr, scope, meta);
  }
  if (resolved !== null && resolved !== "void") {
    expr.resolvedType = resolveTypeIdentity(resolved, meta);
  }
}

// The bounds check reads these fields, so a program that writes them defeats
// it. Keyed on the PARENT's type: a user struct with its own `len` is fine.
function rejectHeaderWrite(
  target: ASTExpression | null,
  token: ASTExpression["token"],
  scope: Scope,
  meta: ModuleMeta,
  errors: MapleError[],
): void {
  if (!(target instanceof MemberExpression || target instanceof PointerMemberExpression)) return;
  if (target.member !== "len" && target.member !== "data") return;
  const parentType = resolveExprType(target.parent, scope, meta, errors);
  if (parentType === null) return;
  if (parentType !== "string" && !parentType.endsWith("[]")) return;
  const name = target.parent instanceof Identifier ? target.parent.tokenLiteral() : parentType;
  errors.push(new MapleError(`cannot assign to '${name}.${target.member}'`, token.line, token.col));
}

function isLvalue(expr: ASTExpression): boolean {
  return (
    expr instanceof Identifier ||
    expr instanceof MemberExpression ||
    expr instanceof PointerMemberExpression ||
    expr instanceof IndexExpression
  );
}

function requireOperatorDomain(
  operator: string,
  types: Array<string | null>,
  token: ASTExpression["token"],
  errors: MapleError[],
): void {
  const domain = BITWISE_OPS.has(operator) || operator === "~" ? "integer" : "numeric";
  const allowed = domain === "integer" ? INTEGER_TYPES : NUMERIC_TYPES;
  if (types.some((type) => type !== null && !allowed.has(type))) {
    errors.push(
      new MapleError(`operator '${operator}' requires ${domain} operands`, token.line, token.col),
    );
  }
}

function checkMutationBinding(
  target: ASTExpression,
  token: ASTExpression["token"],
  scope: Scope,
  meta: ModuleMeta,
  errors: MapleError[],
): void {
  const name = getMutatedBindingName(target);
  if (name === null) return;
  const imported = meta.imports[name];
  if (imported?.info?.kind === "global") {
    errors.push(new MapleError("cannot assign to imported global", token.line, token.col));
    return;
  }
  const entry = scope.get(name);
  if (entry && !entry.mutable) {
    errors.push(new MapleError(`Cannot assign to constant '${name}'`, token.line, token.col));
  }
}

// ─── AST walkers ──────────────────────────────────────────────────────────────

function walkExpression(
  expr: ASTExpression | null,
  scope: Scope,
  meta: ModuleMeta,
  errors: MapleError[],
  expectedType?: string,
  position: ExpressionPosition = "value",
  allowStructInitializer = false,
): void {
  if (!expr) return;

  try {
    if (expr instanceof IntegerLiteralExpression) {
      const literalType =
        expectedType !== undefined && integerRange(expectedType) ? expectedType : "i32";
      checkIntegerLiteralRange(expr, literalType, errors);
      return;
    }

    // Identifier checks
    if (expr instanceof Identifier) {
      const id = expr.tokenLiteral();
      const t = expr.token;
      if (getIntrinsic(id)) {
        errors.push(new MapleError(`cannot take a reference to intrinsic '${id}'`, t.line, t.col));
        return;
      }
      if (id === "_start") {
        errors.push(new MapleError("cannot take a reference to '_start'", t.line, t.col));
        return;
      }
      const imp = meta.imports[id];
      if (imp?.info?.kind === "func") {
        if (!imp.mergeable) {
          errors.push(
            new MapleError(`cannot take a reference to imported function '${id}'`, t.line, t.col),
          );
          return;
        }
        const resolution = resolveIdentifier(expr, scope, meta);
        if (resolution) {
          (expr as ASTExpression).resolvedType = resolution.type;
          (expr as ASTExpression).resolvedDecl = resolution.decl;
        }
        return;
      }
      const resolution = resolveIdentifier(expr, scope, meta);
      if (!resolution) {
        errors.push(new MapleError(`Undefined identifier '${id}'`, t.line, t.col));
        return;
      }
      (expr as ASTExpression).resolvedType = resolution.type;
      (expr as ASTExpression).resolvedDecl = resolution.decl;
      return;
    }

    // Check 3 — mixed arithmetic / bitwise on float
    if (expr instanceof InfixExpression) {
      const contextualType = integerRange(expectedType) ? expectedType : undefined;
      const leftSiblingType =
        expr.right instanceof IntegerLiteralExpression
          ? contextualType
          : resolveExprType(expr.right, scope, meta, errors);
      const rightSiblingType =
        expr.left instanceof IntegerLiteralExpression
          ? contextualType
          : resolveExprType(expr.left, scope, meta, errors);
      const leftExpected = integerRange(leftSiblingType ?? undefined)
        ? (leftSiblingType ?? undefined)
        : contextualType;
      const rightExpected = integerRange(rightSiblingType ?? undefined)
        ? (rightSiblingType ?? undefined)
        : contextualType;
      walkExpression(expr.left, scope, meta, errors, leftExpected);
      walkExpression(expr.right, scope, meta, errors, rightExpected);

      const resolvedLeftType = resolveExprType(expr.left, scope, meta, errors);
      const resolvedRightType = resolveExprType(expr.right, scope, meta, errors);
      if (resolvedLeftType !== null && resolvedRightType !== null) {
        const [leftType, rightType] = adoptedOperandTypes(
          expr.left,
          expr.right,
          resolvedLeftType,
          resolvedRightType,
        );
        if (SAME_LANE_OPS.has(expr.operator)) {
          if (valueTypeToWasm(leftType) !== valueTypeToWasm(rightType)) {
            const t = expr.token;
            errors.push(
              new MapleError(
                `Mixed types in arithmetic: '${leftType}' and '${rightType}' — use explicit cast`,
                t.line,
                t.col,
              ),
            );
          }
        }
        if (SIGN_MIXING_OPS.has(expr.operator)) {
          checkMixedSignedness(leftType, rightType, expr.token, errors);
        }
      }
      if (BITWISE_OPS.has(expr.operator) || ARITHMETIC_OPS.has(expr.operator)) {
        requireOperatorDomain(
          expr.operator,
          [resolvedLeftType, resolvedRightType],
          expr.token,
          errors,
        );
      }
      return;
    }

    // Check 4 — call argument count and types
    if (expr instanceof CallExpression) {
      const resolution = resolveCall(expr, scope, meta);
      if (resolution === null) {
        errors.push(
          new MapleError(`Undefined function '${expr.func}'`, expr.token.line, expr.token.col),
        );
        for (const argument of expr.args) walkExpression(argument, scope, meta, errors);
        return;
      }
      if (resolution === "not-callable") {
        errors.push(
          new MapleError(`'${expr.func}' is not callable`, expr.token.line, expr.token.col),
        );
        for (const argument of expr.args) walkExpression(argument, scope, meta, errors);
        return;
      }

      (expr as ASTExpression).resolvedCallTarget = resolution.target;
      if (resolution.decl) (expr as ASTExpression).resolvedDecl = resolution.decl;
      else delete (expr as ASTExpression).resolvedDecl;
      (expr as ASTExpression).resolvedResultTypes = resolution.results;
      if (resolution.results.length === 1) {
        (expr as ASTExpression).resolvedType = resolution.results[0]!;
      } else {
        delete (expr as ASTExpression).resolvedType;
      }

      for (let index = 0; index < expr.args.length; index++) {
        const parameterIndex = index - resolution.argumentOffset;
        const expected = parameterIndex >= 0 ? resolution.params[parameterIndex] : undefined;
        walkExpression(expr.args[index]!, scope, meta, errors, expected);
      }

      const actualCount = expr.args.length - resolution.argumentOffset;
      if (actualCount !== resolution.params.length) {
        const prefix =
          resolution.kind === "intrinsic"
            ? `Intrinsic '${expr.func}'`
            : resolution.kind === "indirect"
              ? `Indirect call to '${expr.func}'`
              : `Function '${expr.func}'`;
        errors.push(
          new MapleError(
            `${prefix} expects ${resolution.params.length} arguments, got ${actualCount}`,
            expr.token.line,
            expr.token.col,
          ),
        );
      } else {
        for (let index = 0; index < resolution.params.length; index++) {
          const argument = expr.args[index + resolution.argumentOffset]!;
          const argumentType = resolveExprType(argument, scope, meta, errors);
          const parameterType = resolution.params[index]!;
          if (
            index === 0 &&
            argumentType !== null &&
            isAllocatorPointerArgument(expr.func, meta) &&
            isStructType(argumentType, meta)
          ) {
            continue;
          }
          if (argumentType !== null && !typesCompatible(parameterType, argumentType, meta)) {
            errors.push(
              new MapleError(
                `Type mismatch in argument ${index + 1} of '${expr.func}': expected '${parameterType}', got '${argumentType}'`,
                argument.token.line,
                argument.token.col,
              ),
            );
          }
        }
      }

      if (position === "value" && resolution.results.length === 0) {
        errors.push(new MapleError("void call used as a value", expr.token.line, expr.token.col));
      } else if (position === "value" && resolution.results.length > 1) {
        errors.push(
          new MapleError(
            "multi-return value cannot be used as a single value",
            expr.token.line,
            expr.token.col,
          ),
        );
      }
      return;
    }

    // Check 5 — struct member existence (arrays only expose len/data)
    if (expr instanceof MemberExpression || expr instanceof PointerMemberExpression) {
      walkExpression(expr.parent, scope, meta, errors);
      const parentType = resolveExprType(expr.parent, scope, meta, errors);
      if (parentType) {
        if (parentType.endsWith("[]")) {
          if (expr.member !== "len" && expr.member !== "data") {
            const t = expr.token;
            errors.push(new MapleError(`Array type has no member '${expr.member}'`, t.line, t.col));
          }
        } else {
          const structName = parentType.startsWith("*") ? parentType.slice(1) : parentType;
          const structDef = structDefinition(structName, meta);
          if (!structDef) {
            const t = expr.token;
            errors.push(new MapleError(`type '${parentType}' has no members`, t.line, t.col));
          } else if (!(expr.member in structDef.members)) {
            const t = expr.token;
            errors.push(
              new MapleError(
                `Struct '${structName}' has no member '${expr.member}'`,
                t.line,
                t.col,
              ),
            );
          }
        }
      }
      return;
    }

    // Check 6 — const mutation (via AssignmentExpression)
    if (expr instanceof AssignmentExpression) {
      if (position !== "effect") {
        errors.push(new MapleError("assignment is a statement", expr.token.line, expr.token.col));
      }
      if (!isLvalue(expr.left)) {
        errors.push(new MapleError("invalid assignment target", expr.token.line, expr.token.col));
      }
      checkMutationBinding(expr.left, expr.token, scope, meta, errors);
      rejectHeaderWrite(expr.left, expr.token, scope, meta, errors);
      walkExpression(expr.left, scope, meta, errors);
      const targetType = resolveExprType(expr.left, scope, meta, errors);
      const assignedValue = expr.value;
      walkExpression(assignedValue, scope, meta, errors, targetType ?? undefined);
      const valueType = assignedValue ? resolveExprType(assignedValue, scope, meta, errors) : null;
      if (
        targetType !== null &&
        valueType !== null &&
        !typesCompatible(targetType, valueType, meta)
      ) {
        errors.push(
          new MapleError(
            `Type mismatch: cannot assign '${valueType}' to '${targetType}'`,
            expr.token.line,
            expr.token.col,
          ),
        );
      }
      const compoundOperator = expr.operator === "=" ? null : expr.operator.slice(0, -1);
      if (
        targetType !== null &&
        assignedValue !== null &&
        valueType !== null &&
        compoundOperator !== null &&
        SIGN_MIXING_OPS.has(compoundOperator)
      ) {
        const [leftType, rightType] = adoptedOperandTypes(
          expr.left,
          assignedValue,
          targetType,
          valueType,
        );
        checkMixedSignedness(leftType, rightType, expr.token, errors);
      }
      if (compoundOperator !== null) {
        requireOperatorDomain(compoundOperator, [targetType, valueType], expr.token, errors);
      }
      return;
    }

    if (expr instanceof StructLiteralExpression) {
      if (!allowStructInitializer) {
        errors.push(
          new MapleError(
            "struct literals are only supported as initializers",
            expr.token.line,
            expr.token.col,
          ),
        );
      }
      const identity = resolveTypeIdentity(expr.name, meta);
      const sd = structDefinition(identity, meta);
      if (!sd) return;

      for (const fieldName of Object.keys(expr.members)) {
        if (!(fieldName in sd.members)) {
          const t = expr.token;
          errors.push(
            new MapleError(`Struct '${identity}' has no field '${fieldName}'`, t.line, t.col),
          );
        }
      }

      for (const fieldName of Object.keys(sd.members)) {
        if (!(fieldName in expr.members)) {
          const t = expr.token;
          errors.push(
            new MapleError(
              `Struct '${identity}' field '${fieldName}' is not initialized`,
              t.line,
              t.col,
            ),
          );
        }
      }

      for (const [fieldName, fieldExpr] of Object.entries(expr.members)) {
        const memberMeta = sd.members[fieldName];
        if (!memberMeta) continue;
        walkExpression(fieldExpr, scope, meta, errors, memberMeta.type);
        const fieldType = resolveExprType(fieldExpr, scope, meta, errors);
        if (fieldType !== null && !typesCompatible(memberMeta.type, fieldType, meta)) {
          const t = fieldExpr.token;
          errors.push(
            new MapleError(
              `Struct '${identity}' field '${fieldName}': expected '${memberMeta.type}', got '${fieldType}'`,
              t.line,
              t.col,
            ),
          );
        }
      }
      return;
    }

    if (expr instanceof ArrayLiteralExpression) {
      const nested = expr.elements.find((element) => element instanceof ArrayLiteralExpression);
      if (nested) {
        errors.push(
          new MapleError(
            "nested array literals are not supported yet",
            nested.token.line,
            nested.token.col,
          ),
        );
        return;
      }

      for (const element of expr.elements) {
        walkExpression(element, scope, meta, errors, expr.memberType);
        const elementType = resolveExprType(element, scope, meta, errors);
        if (elementType !== null && !typesCompatible(expr.memberType, elementType, meta)) {
          errors.push(
            new MapleError(
              `array element: expected '${expr.memberType}', got '${elementType}'`,
              element.token.line,
              element.token.col,
            ),
          );
        }
      }
      return;
    }

    if (expr instanceof PrefixExpression) {
      walkExpression(expr.right, scope, meta, errors, expectedType);
      const operandType = expr.right ? resolveExprType(expr.right, scope, meta, errors) : null;
      if (expr.operator === "~" || expr.operator === "-") {
        requireOperatorDomain(expr.operator, [operandType], expr.token, errors);
      }
      return;
    }

    if (expr instanceof PostfixExpression) {
      walkExpression(expr.left, scope, meta, errors);
      if (!expr.left || !isLvalue(expr.left)) {
        errors.push(new MapleError("invalid assignment target", expr.token.line, expr.token.col));
        return;
      }
      if (position === "value" && !(expr.left instanceof Identifier)) {
        errors.push(
          new MapleError(
            "value-position increment requires a plain variable",
            expr.token.line,
            expr.token.col,
          ),
        );
      }
      checkMutationBinding(expr.left, expr.token, scope, meta, errors);
      rejectHeaderWrite(expr.left, expr.token, scope, meta, errors);
      const operandType = resolveExprType(expr.left, scope, meta, errors);
      requireOperatorDomain(expr.operator, [operandType], expr.token, errors);
      return;
    }

    if (expr instanceof CastExpression) {
      checkKnownType(expr.targetType, expr.token, meta, errors);
      if (expr.expr instanceof IntegerLiteralExpression) {
        if (integerRange(expr.targetType)) {
          expr.expr.numericType = expr.targetType.endsWith("64") ? "i64" : "i32";
          (expr.expr as ASTExpression).resolvedType = resolveTypeIdentity(expr.targetType, meta);
        } else {
          walkExpression(expr.expr, scope, meta, errors);
        }
      } else {
        walkExpression(expr.expr, scope, meta, errors);
      }
      const sourceType = resolveExprType(expr.expr, scope, meta, errors);
      const targetType = resolveTypeIdentity(expr.targetType, meta);
      const sourceAggregate =
        sourceType !== null &&
        (sourceType === "string" || sourceType.endsWith("[]") || isFnType(sourceType));
      const targetAggregate =
        targetType === "string" || targetType.endsWith("[]") || isFnType(targetType);
      // Struct casts are ASYMMETRIC: `i32 as Struct` is the allocation idiom
      // and stays; every other direction reinterprets memory (decision O8).
      if (sourceType !== null && isStructType(sourceType, meta)) {
        errors.push(new MapleError("cannot cast a struct value", expr.token.line, expr.token.col));
      } else if (isStructType(targetType, meta) && sourceType !== null && sourceType !== "i32") {
        errors.push(
          new MapleError(
            `cannot cast '${sourceType}' to a struct type`,
            expr.token.line,
            expr.token.col,
          ),
        );
      } else if (
        sourceType !== null &&
        ((sourceAggregate && NUMERIC_TYPES.has(targetType)) ||
          (NUMERIC_TYPES.has(sourceType) && targetAggregate) ||
          (sourceAggregate && targetAggregate && sourceType !== targetType))
      ) {
        errors.push(
          new MapleError(
            `cannot cast '${sourceType}' to '${targetType}'`,
            expr.token.line,
            expr.token.col,
          ),
        );
      }
      return;
    }

    if (expr instanceof IndexExpression) {
      walkExpression(expr.left, scope, meta, errors);
      walkExpression(expr.index, scope, meta, errors, "i32");
      const containerType = resolveExprType(expr.left, scope, meta, errors);
      const indexType = resolveExprType(expr.index, scope, meta, errors);
      if (
        containerType !== null &&
        !(containerType.endsWith("[]") || containerType.startsWith("*"))
      ) {
        errors.push(
          new MapleError(
            `type '${containerType}' is not indexable`,
            expr.token.line,
            expr.token.col,
          ),
        );
      }
      if (indexType !== null && !I32_LANE_INDEX_TYPES.has(indexType)) {
        errors.push(
          new MapleError(
            "array index must be an i32-lane value",
            expr.index.token.line,
            expr.index.token.col,
          ),
        );
      }
      return;
    }

    if (expr instanceof FunctionLiteralExpression) {
      errors.push(
        new MapleError("function literals are not supported yet", expr.token.line, expr.token.col),
      );
      return;
    }
  } finally {
    stampExpression(expr, scope, meta, expectedType, position);
  }
}

function getMutatedBindingName(target: ASTExpression): string | null {
  if (target instanceof Identifier) return target.tokenLiteral();
  if (target instanceof MemberExpression || target instanceof PointerMemberExpression) {
    return getMutatedBindingName(target.parent);
  }
  if (target instanceof IndexExpression) {
    return getMutatedBindingName(target.left);
  }
  return null;
}

function checkLetInitializer(
  stmt: LetStatement,
  scope: Scope,
  meta: ModuleMeta,
  errors: MapleError[],
): void {
  checkKnownType(stmt.typeAnnotation, stmt.token, meta, errors);
  if (stmt.expression === null) return;
  // `fn(A,B): R[]` reads as both "returns R[]" and "array of fn returning R",
  // so annotation and literal agreed and lowering ICEd on the element.
  if (stmt.expression instanceof ArrayLiteralExpression && isFnType(stmt.typeAnnotation)) {
    errors.push(
      new MapleError(
        "array of function references is not supported",
        stmt.token.line,
        stmt.token.col,
      ),
    );
    return;
  }
  walkExpression(stmt.expression, scope, meta, errors, stmt.typeAnnotation, "value", true);
  const actualType = resolveExprType(stmt.expression, scope, meta, errors);
  if (actualType !== null && !typesCompatible(stmt.typeAnnotation, actualType, meta)) {
    const t = stmt.token;
    errors.push(
      new MapleError(
        `Type mismatch: cannot assign '${actualType}' to '${stmt.typeAnnotation}'`,
        t.line,
        t.col,
      ),
    );
  }
}

type FlowContext = {
  loopDepth: number;
  switchDepth: number;
};

function isNumericOrBooleanConditionType(t: string | null): boolean {
  if (t === null) return false;
  if (isFnType(t)) return false;
  if (t === "void" || baseScalar(t) === "void") return false;
  if (t === "bool") return true;
  const w = valueTypeToWasm(t);
  return w === "i32" || w === "i64" || w === "f32" || w === "f64";
}

function walkBlock(
  block: BlockStatement,
  scope: Scope,
  meta: ModuleMeta,
  fnReturnTypes: string[],
  errors: MapleError[],
  ctx: FlowContext = { loopDepth: 0, switchDepth: 0 },
): void {
  // Child scope: `let` inside the block shadows rather than clobbers, and
  // bindings don't leak past the closing brace.
  const blockScope = new Map(scope);
  for (const stmt of block.statements) {
    walkStatement(stmt, blockScope, meta, fnReturnTypes, errors, ctx);
  }
}

function walkEffectExpression(
  expr: ASTExpression | null,
  scope: Scope,
  meta: ModuleMeta,
  errors: MapleError[],
): void {
  if (!expr) return;
  if (
    !(expr instanceof CallExpression) &&
    !(expr instanceof AssignmentExpression) &&
    !(expr instanceof PostfixExpression)
  ) {
    errors.push(
      new MapleError("expression statement has no effect", expr.token.line, expr.token.col),
    );
  }
  walkExpression(expr, scope, meta, errors, undefined, "effect");
}

function walkStatement(
  stmt: ASTStatement,
  scope: Scope,
  meta: ModuleMeta,
  fnReturnTypes: string[],
  errors: MapleError[],
  ctx: FlowContext = { loopDepth: 0, switchDepth: 0 },
): void {
  if (stmt instanceof LetStatement) {
    if (stmt.pattern instanceof TuplePattern) {
      const rhs = stmt.expression;
      if (!(rhs instanceof CallExpression)) {
        const t = stmt.token;
        errors.push(new MapleError("destructure RHS must be a function call", t.line, t.col));
        return;
      }
      walkExpression(rhs, scope, meta, errors, undefined, "multi");
      const returnTypes =
        (rhs as ASTExpression).resolvedResultTypes ?? getCallReturnTypes(meta, rhs.func, scope);
      if (!returnTypes || returnTypes.length < 2) {
        const t = stmt.token;
        errors.push(new MapleError("destructure RHS must be a multi-return call", t.line, t.col));
        return;
      }
      if (returnTypes.length !== stmt.pattern.names.length) {
        const t = stmt.token;
        errors.push(
          new MapleError(
            `destructure arity mismatch: expected ${returnTypes.length}, got ${stmt.pattern.names.length}`,
            t.line,
            t.col,
          ),
        );
        return;
      }
      for (let i = 0; i < stmt.pattern.names.length; i++) {
        const name = stmt.pattern.names[i]!;
        if (name.kind !== "name") continue;
        scope.set(name.value, {
          type: returnTypes[i] ?? "i32",
          mutable: stmt.mutable,
          kind: "local",
        });
      }
      return;
    }

    // Check 1 — assignment type compatibility
    checkLetInitializer(stmt, scope, meta, errors);
    scope.set(stmt.identifier.tokenLiteral(), {
      type: stmt.typeAnnotation,
      mutable: stmt.mutable,
      kind: "local",
    });
    return;
  }

  if (stmt instanceof ReturnStatement) {
    const isVoid = fnReturnTypes.length === 0;
    const returnValues = stmt.returnValues;
    if (isVoid && returnValues.length > 0) {
      const t = stmt.token;
      errors.push(new MapleError("Cannot return a value from a void function", t.line, t.col));
      return;
    }

    if (!isVoid && returnValues.length === 0) {
      const t = stmt.token;
      if (fnReturnTypes.length === 1) {
        errors.push(
          new MapleError(
            `Function must return a value of type '${fnReturnTypes[0]}'`,
            t.line,
            t.col,
          ),
        );
      } else {
        errors.push(
          new MapleError("multi-return function cannot use a void return", t.line, t.col),
        );
      }
      return;
    }

    if (
      fnReturnTypes.length >= 2 &&
      returnValues.length === 1 &&
      returnValues[0] instanceof CallExpression
    ) {
      walkExpression(returnValues[0], scope, meta, errors, undefined, "multi");
      const passTypes =
        (returnValues[0] as ASTExpression).resolvedResultTypes ??
        getCallReturnTypes(meta, returnValues[0].func, scope);
      if (passTypes && passTypes.length >= 2) {
        if (passTypes.length !== fnReturnTypes.length) {
          const t = stmt.token;
          errors.push(new MapleError("pass-through return arity mismatch", t.line, t.col));
          return;
        }
        for (let i = 0; i < fnReturnTypes.length; i++) {
          if (!typesCompatible(fnReturnTypes[i]!, passTypes[i]!, meta)) {
            const t = stmt.token;
            errors.push(
              new MapleError(`pass-through return type mismatch at position ${i}`, t.line, t.col),
            );
            return;
          }
        }
        return;
      }
    }

    if (returnValues.length !== fnReturnTypes.length) {
      const t = stmt.token;
      errors.push(
        new MapleError(
          `Return arity mismatch: expected ${fnReturnTypes.length}, got ${returnValues.length}`,
          t.line,
          t.col,
        ),
      );
      return;
    }

    for (let i = 0; i < returnValues.length; i++) {
      walkExpression(returnValues[i]!, scope, meta, errors, fnReturnTypes[i]);
      const actualType = resolveExprType(returnValues[i]!, scope, meta, errors);
      if (actualType === null) {
        return;
      }
      if (!typesCompatible(fnReturnTypes[i]!, actualType, meta)) {
        const t = stmt.token;
        if (fnReturnTypes.length === 1) {
          errors.push(
            new MapleError(
              `Return type mismatch: expected '${fnReturnTypes[0]}', got '${actualType}'`,
              t.line,
              t.col,
            ),
          );
        } else {
          errors.push(new MapleError(`Return type mismatch at position ${i}`, t.line, t.col));
        }
      }
    }
    return;
  }

  if (stmt instanceof ExpressionStatement) {
    walkEffectExpression(stmt.expression, scope, meta, errors);
    return;
  }

  if (stmt instanceof DeferStatement) {
    walkExpression(stmt.call, scope, meta, errors, undefined, "effect");
    return;
  }

  if (stmt instanceof BreakStatement) {
    if (ctx.loopDepth === 0 && ctx.switchDepth === 0) {
      const t = stmt.token;
      errors.push(new MapleError("break statement must be inside a loop or switch", t.line, t.col));
    }
    return;
  }

  if (stmt instanceof ContinueStatement) {
    if (ctx.loopDepth === 0) {
      const t = stmt.token;
      errors.push(new MapleError("continue statement must be inside a loop", t.line, t.col));
    }
    return;
  }

  if (stmt instanceof IfStatement) {
    walkExpression(stmt.conditionExpr, scope, meta, errors);
    const condType = resolveExprType(stmt.conditionExpr, scope, meta, errors);
    if (condType !== null && !isNumericOrBooleanConditionType(condType)) {
      const t = stmt.token;
      if (isFnType(condType)) {
        errors.push(new MapleError("fn-typed value is not a valid condition", t.line, t.col));
      } else {
        errors.push(
          new MapleError(
            `if condition must be a numeric or boolean expression, got '${condType}'`,
            t.line,
            t.col,
          ),
        );
      }
    }
    walkBlock(stmt.thenBlock, scope, meta, fnReturnTypes, errors, ctx);
    if (stmt.elseBlock) {
      walkBlock(stmt.elseBlock, scope, meta, fnReturnTypes, errors, ctx);
    }
    return;
  }

  if (stmt instanceof WhileStatement) {
    const loopCtx: FlowContext = { loopDepth: ctx.loopDepth + 1, switchDepth: ctx.switchDepth };
    walkExpression(stmt.condExpr, scope, meta, errors);
    const condType = resolveExprType(stmt.condExpr, scope, meta, errors);
    if (condType !== null && !isNumericOrBooleanConditionType(condType)) {
      const t = stmt.token;
      if (isFnType(condType)) {
        errors.push(new MapleError("fn-typed value is not a valid condition", t.line, t.col));
      } else {
        errors.push(
          new MapleError(
            `while condition must be a numeric or boolean expression, got '${condType}'`,
            t.line,
            t.col,
          ),
        );
      }
    }
    walkBlock(stmt.loopBody, scope, meta, fnReturnTypes, errors, loopCtx);
    return;
  }

  if (stmt instanceof ForStatement) {
    // Create an isolated child scope so the init variable doesn't leak after the loop
    const loopScope = new Map(scope);
    const loopCtx: FlowContext = { loopDepth: ctx.loopDepth + 1, switchDepth: ctx.switchDepth };
    // Check 1 for for-loop initializer
    checkLetInitializer(stmt.initBlock, loopScope, meta, errors);
    if (!(stmt.initBlock.pattern instanceof TuplePattern)) {
      loopScope.set(stmt.initBlock.identifier.tokenLiteral(), {
        type: stmt.initBlock.typeAnnotation,
        mutable: stmt.initBlock.mutable,
        kind: "local",
      });
    }
    const forCondEx = stmt.conditionExpr.expression;
    if (forCondEx) {
      walkExpression(forCondEx, loopScope, meta, errors);
      const forCondType = resolveExprType(forCondEx, loopScope, meta, errors);
      if (forCondType !== null && !isNumericOrBooleanConditionType(forCondType)) {
        const t = stmt.conditionExpr.token;
        if (isFnType(forCondType)) {
          errors.push(new MapleError("fn-typed value is not a valid condition", t.line, t.col));
        } else {
          errors.push(
            new MapleError(
              `for loop condition must be a numeric or boolean expression, got '${forCondType}'`,
              t.line,
              t.col,
            ),
          );
        }
      }
    }
    walkEffectExpression(stmt.updateExpr.expression, loopScope, meta, errors);
    walkBlock(stmt.loopBody, loopScope, meta, fnReturnTypes, errors, loopCtx);
    return;
  }

  if (stmt instanceof SwitchStatement) {
    const switchCtx: FlowContext = { loopDepth: ctx.loopDepth, switchDepth: ctx.switchDepth + 1 };
    walkExpression(stmt.switchExpr, scope, meta, errors);
    const st = resolveExprType(stmt.switchExpr, scope, meta, errors);
    if (st !== null) {
      const w = valueTypeToWasm(st);
      if (w === "i64" || w === "f32" || w === "f64") {
        const t = stmt.token;
        errors.push(
          new MapleError(
            `switch discriminant must be an i32-compatible type, got '${st}'`,
            t.line,
            t.col,
          ),
        );
      }
    }
    for (const c of stmt.cases) {
      walkBlock(c.body, scope, meta, fnReturnTypes, errors, switchCtx);
    }
    if (stmt.default) {
      walkBlock(stmt.default, scope, meta, fnReturnTypes, errors, switchCtx);
    }
    return;
  }

  if (stmt instanceof BlockStatement) {
    walkBlock(stmt, scope, meta, fnReturnTypes, errors, ctx);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const ALLOCATOR_POINTER_FUNCTIONS = new Set(["free", "realloc"]);

// One compiler-known rule over two imported names: Maple has no overloads, and
// without this decision O8 would leave heap structs unfreeable.
function isAllocatorPointerArgument(callee: string, meta: ModuleMeta): boolean {
  if (!ALLOCATOR_POINTER_FUNCTIONS.has(callee)) return false;
  const imported = meta.imports[callee];
  return imported?.module === "memory" || imported?.module === "memory_debug";
}

const ESCAPE_MESSAGES: Record<EscapeViolation["site"], string> = {
  return: "cannot return a frame-backed value",
  global: "cannot store a frame-backed value in a global",
  store: "cannot store a frame-backed value",
  "free-frame": "cannot free a frame-backed value",
  "free-static": "cannot free a static value",
};

// The frame is released before a return hands the pointer out, so an escaping
// struct literal is a live miscompile (B25). Heap structs are unaffected.
function reportEscapes(
  body: BlockStatement,
  globals: Scope,
  staticGlobals: Set<string>,
  meta: ModuleMeta,
  errors: MapleError[],
): void {
  const analysis = analyzeEscapes(
    body,
    (name) => globals.get(name)?.kind === "global",
    (expr) => {
      const type = expr.resolvedType;
      if (type === undefined) return false;
      return type === "string" || type.endsWith("[]") || isStructType(type, meta);
    },
    (name) => staticGlobals.has(name),
    (expr) =>
      expr instanceof CallExpression && isAllocatorPointerArgument(expr.func, meta)
        ? expr.args[0]
        : undefined,
  );
  for (const violation of analysis.violations) {
    errors.push(
      new MapleError(ESCAPE_MESSAGES[violation.site], violation.token.line, violation.token.col),
    );
  }
}

export function typeCheck(program: ASTProgram, meta: ModuleMeta): MapleError[] {
  const errors: MapleError[] = [];

  // Build global scope: stdlib imported globals first, then top-level lets, then functions
  const globals: Scope = new Map();
  for (const [id, imp] of Object.entries(meta.imports)) {
    if (imp.info?.kind === "global") {
      globals.set(id, { type: imp.mapleType ?? imp.info.type, mutable: false, kind: "import" });
    }
  }
  for (const stmt of program.statements) {
    if (stmt instanceof DeferStatement) {
      errors.push(
        new MapleError(
          "defer is only allowed inside a function body",
          stmt.token.line,
          stmt.token.col,
        ),
      );
      continue;
    }
    if (stmt instanceof LetStatement) {
      if (stmt.pattern instanceof TuplePattern) {
        errors.push(
          new MapleError(
            "top-level destructuring let is not supported",
            stmt.token.line,
            stmt.token.col,
          ),
        );
        continue;
      }
      globals.set(stmt.identifier.tokenLiteral(), {
        type: stmt.typeAnnotation,
        mutable: stmt.mutable,
        kind: "global",
      });
    }
  }
  // All user-defined functions are callable values (fn-type)
  for (const [fnName, fnMeta] of Object.entries(meta.functions)) {
    const paramTypes = fnMeta.params.map((p) => p.type);
    const results = fnMeta.mapleResults;
    const key = canonicalFnType(paramTypes, results);
    globals.set(fnName, { type: key, mutable: false, kind: "function" });
  }

  for (const stmt of program.statements) {
    if (!(stmt instanceof StructStatement)) continue;
    for (const member of Object.values(stmt.members)) {
      checkKnownType(member.type, stmt.token, meta, errors);
    }
  }

  // Check top-level globals (Check 1)
  for (const stmt of program.statements) {
    if (stmt instanceof LetStatement) {
      if (stmt.pattern instanceof TuplePattern) continue;
      checkLetInitializer(stmt, globals, meta, errors);
    }
  }

  // Module-scope literal bindings have static storage duration: freeing one
  // is never valid, however many names it has picked up (D4).
  const staticGlobals = new Set<string>();
  for (const stmt of program.statements) {
    if (!(stmt instanceof LetStatement) || stmt.pattern instanceof TuplePattern) continue;
    const initializer = stmt.expression;
    if (
      initializer instanceof StructLiteralExpression ||
      initializer instanceof ArrayLiteralExpression ||
      initializer instanceof StringLiteralExpression
    ) {
      staticGlobals.add(stmt.identifier.tokenLiteral());
    }
  }

  // Check each function body
  for (const stmt of program.statements) {
    if (!(stmt instanceof FunctionStatement)) continue;
    for (const param of stmt.fnExpr.params) {
      checkKnownType(param.type, param.identifier.token, meta, errors);
    }
    for (const returnType of stmt.fnExpr.returnTypes) {
      checkKnownType(returnType, stmt.token, meta, errors);
    }
    if (stmt.receiverType && !(stmt.receiverType in meta.structs)) {
      errors.push(
        new MapleError(
          `Method declared on unknown struct '${stmt.receiverType}'`,
          stmt.token.line,
          stmt.token.col,
        ),
      );
    }

    // Build per-function scope: globals + params
    const scope: Scope = new Map(globals);
    for (const param of stmt.fnExpr.params) {
      scope.set(param.identifier.tokenLiteral(), {
        type: param.type,
        mutable: false,
        kind: "param",
      });
    }

    const fnReturnTypes = stmt.fnExpr.returnTypes;
    walkBlock(stmt.fnExpr.body, scope, meta, fnReturnTypes, errors);
    reportEscapes(stmt.fnExpr.body, globals, staticGlobals, meta, errors);
    if (fnReturnTypes.length > 0 && !stmtDefinitelyReturns(stmt.fnExpr.body)) {
      const returnType =
        fnReturnTypes.length === 1 ? fnReturnTypes[0]! : `(${fnReturnTypes.join(", ")})`;
      errors.push(
        new MapleError(
          `function '${stmt.name}' must return '${returnType}' on all paths`,
          stmt.token.line,
          stmt.token.col,
        ),
      );
    }
  }

  return errors;
}
