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
import { ExpressionStatement } from "../parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../parser/ast/statements/ForStatement";
import { FunctionStatement } from "../parser/ast/statements/FunctionStatement";
import { IfStatement } from "../parser/ast/statements/IfStatement";
import { LetStatement } from "../parser/ast/statements/LetStatement";
import { ReturnStatement } from "../parser/ast/statements/ReturnStatement";
import { SwitchStatement } from "../parser/ast/statements/SwitchStatement";
import { TuplePattern } from "../parser/ast/statements/TuplePattern";
import { WhileStatement } from "../parser/ast/statements/WhileStatement";
import type { ASTExpression, ASTStatement } from "../parser/ast/types/ast.type";
import {
  baseScalar,
  canonicalFnType,
  cmpOps,
  isFnType,
  isUnsignedMapleInteger,
  parseFnType,
  valueTypeToWasm,
} from "./emitters/emit.types";
import type { ModuleMeta } from "./emitters/emitter.types";
import { MapleError } from "./errors";

const ARITHMETIC_OPS = new Set(["+", "-", "*", "/", "%"]);
const BITWISE_OPS = new Set(["&", "|", "^", "<<", ">>"]);
const ORDERING_OPS = new Set(["<", "<=", ">", ">="]);
const SIGN_MIXING_OPS = new Set([...ARITHMETIC_OPS, "&", "|", "^", ...ORDERING_OPS]);
const SAME_LANE_OPS = new Set([...ARITHMETIC_OPS, ...cmpOps]);
const LITERAL_ADOPTION_OPS = new Set([...ARITHMETIC_OPS, ...BITWISE_OPS]);

// ─── Scope ────────────────────────────────────────────────────────────────────

type ScopeEntry = { type: string; mutable: boolean };
type Scope = Map<string, ScopeEntry>;

function getCallReturnTypes(meta: ModuleMeta, fnName: string, scope?: Scope): string[] | null {
  const fn = meta.functions[fnName];
  if (fn) return fn.mapleResults;

  if (scope) {
    const entry = scope.get(fnName);
    if (entry && isFnType(entry.type)) {
      const parsed = parseFnType(entry.type);
      if (parsed) {
        const r = parsed.results;
        if (r.length === 1 && r[0] === "void") return [];
        return r;
      }
    }
  }

  const imp = meta.imports[fnName];
  if (imp?.info?.kind === "func") {
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

// ─── Expression type resolver ─────────────────────────────────────────────────
//
// Returns the Maple-level type string (e.g. "i32", "f32", "bool", "Point",
// "i32[]") or null when the type cannot be statically determined.  Returning
// null means "skip this check" — the emitter will surface the error later.

function resolveExprType(
  expr: ASTExpression,
  scope: Scope,
  meta: ModuleMeta,
  errors?: MapleError[],
): string | null {
  if (expr instanceof IntegerLiteralExpression) {
    return expr.numericType === "i64" ? "i64" : "i32";
  }
  if (expr instanceof FloatLiteralExpression) {
    return expr.numericType === "f64" ? "f64" : "f32";
  }
  if (expr instanceof BooleanLiteralExpression) return "bool";
  if (expr instanceof StringLiteralExpression) return "string";
  if (expr instanceof ArrayLiteralExpression) return `${expr.memberType}[]`;

  if (expr instanceof Identifier) {
    const id = expr.tokenLiteral();
    const imp = meta.imports[id];
    if (imp?.info?.kind === "global") {
      return imp.info.type;
    }
    return scope.get(id)?.type ?? null;
  }

  if (expr instanceof CastExpression) {
    return expr.targetType;
  }

  if (expr instanceof InfixExpression) {
    if (cmpOps.has(expr.operator)) return "bool";
    const lt = resolveExprType(expr.left, scope, meta, errors);
    const rt = resolveExprType(expr.right, scope, meta, errors);
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
      return expr.right ? resolveExprType(expr.right, scope, meta, errors) : "i32";
    }
    if (expr.operator === "-") {
      return expr.right ? resolveExprType(expr.right, scope, meta, errors) : "i32";
    }
    return "i32";
  }

  if (expr instanceof PostfixExpression) {
    return expr.left ? resolveExprType(expr.left, scope, meta, errors) : "i32";
  }

  if (expr instanceof CallExpression) {
    const returnTypes = getCallReturnTypes(meta, expr.func, scope);
    if (!returnTypes) return null;
    if (returnTypes.length === 0) return "void";
    if (returnTypes.length === 1) return returnTypes[0] ?? null;
    if (errors) {
      const t = expr.token;
      errors.push(
        new MapleError("multi-return value cannot be used as a single value", t.line, t.col),
      );
    }
    return null;
  }

  if (expr instanceof IndexExpression) {
    const containerType = resolveExprType(expr.left, scope, meta, errors);
    if (!containerType) return null;
    if (!(containerType.endsWith("[]") || containerType.startsWith("*"))) return null;
    return baseScalar(containerType);
  }

  if (expr instanceof MemberExpression || expr instanceof PointerMemberExpression) {
    const parentType = resolveExprType(expr.parent, scope, meta, errors);
    if (!parentType) return null;
    // Arrays expose the same {len, data} header members as strings.
    if (parentType.endsWith("[]")) {
      return expr.member === "len" || expr.member === "data" ? "i32" : null;
    }
    const structName = parentType.startsWith("*") ? parentType.slice(1) : parentType;
    const memberData = meta.structs[structName]?.members[expr.member];
    return memberData?.type ?? null;
  }

  if (expr instanceof AssignmentExpression) {
    return resolveExprType(expr.left, scope, meta, errors);
  }
  if (expr instanceof StructLiteralExpression) {
    return expr.name;
  }

  if (expr instanceof FunctionLiteralExpression) {
    const paramTypes = expr.params.map((p) => p.type);
    const results = expr.returnTypes.length === 0 ? ["void"] : expr.returnTypes;
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
  if (declared === actual) return true;
  if (isFnType(declared) && isFnType(actual)) return declared === actual;
  if (isFnType(declared) || isFnType(actual)) return false;
  if (declared === "void" || actual === "void") return false;
  if (declared === "string" || actual === "string") return false;
  if (declared in meta.structs || actual in meta.structs) return false;
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

// ─── AST walkers ──────────────────────────────────────────────────────────────

function walkExpression(
  expr: ASTExpression | null,
  scope: Scope,
  meta: ModuleMeta,
  errors: MapleError[],
  expectedType?: string,
): void {
  if (!expr) return;

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
    if (id === "_start") {
      errors.push(new MapleError("cannot take a reference to '_start'", t.line, t.col));
      return;
    }
    const imp = meta.imports[id];
    if (imp?.info?.kind === "func") {
      errors.push(
        new MapleError(`cannot take a reference to imported function '${id}'`, t.line, t.col),
      );
      return;
    }
    if (!scope.has(id)) {
      errors.push(new MapleError(`Undefined identifier '${id}'`, t.line, t.col));
    }
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
    if (BITWISE_OPS.has(expr.operator)) {
      const bad = (x: string | null) =>
        x !== null && (valueTypeToWasm(x) === "f32" || valueTypeToWasm(x) === "f64");
      if (bad(resolvedLeftType) || bad(resolvedRightType)) {
        const t = expr.token;
        errors.push(
          new MapleError(
            `Bitwise operator '${expr.operator}' is only valid for integer types`,
            t.line,
            t.col,
          ),
        );
      }
    }
    return;
  }

  // Check 4 — call argument count and types
  if (expr instanceof CallExpression) {
    const fn = meta.functions[expr.func];
    const localFnType = scope.get(expr.func)?.type;
    const localParams =
      localFnType && isFnType(localFnType) ? parseFnType(localFnType)?.params : null;
    const importSignature = meta.imports[expr.func]?.info;
    const importedParamChars =
      importSignature?.kind === "func" ? (importSignature.signature.split("_")[0] ?? "") : null;
    const importedParams =
      importedParamChars !== null
        ? Array.from(importedParamChars === "v" ? "" : importedParamChars).map((char) => {
            if (char === "I") return "i64";
            if (char === "f") return "f32";
            if (char === "F") return "f64";
            return "i32";
          })
        : null;
    const parameterTypes = fn?.params.map((param) => param.type) ?? localParams ?? importedParams;
    for (let i = 0; i < expr.args.length; i++) {
      walkExpression(expr.args[i]!, scope, meta, errors, parameterTypes?.[i]);
    }
    if (fn) {
      if (expr.args.length !== fn.params.length) {
        const t = expr.token;
        errors.push(
          new MapleError(
            `Function '${expr.func}' expects ${fn.params.length} arguments, got ${expr.args.length}`,
            t.line,
            t.col,
          ),
        );
      } else {
        for (let i = 0; i < expr.args.length; i++) {
          const argType = resolveExprType(expr.args[i]!, scope, meta, errors);
          const paramType = fn.params[i]!.type;
          if (argType !== null && !typesCompatible(paramType, argType, meta)) {
            const t = expr.args[i]!.token;
            errors.push(
              new MapleError(
                `Type mismatch in argument ${i + 1} of '${expr.func}': expected '${paramType}', got '${argType}'`,
                t.line,
                t.col,
              ),
            );
          }
        }
      }
    } else {
      const localEntry = scope.get(expr.func);
      if (localEntry && isFnType(localEntry.type)) {
        // Indirect call through fn-typed variable
        const parsed = parseFnType(localEntry.type);
        if (parsed && expr.args.length !== parsed.params.length) {
          const t = expr.token;
          errors.push(
            new MapleError(
              `Indirect call to '${expr.func}' expects ${parsed.params.length} arguments, got ${expr.args.length}`,
              t.line,
              t.col,
            ),
          );
        }
      } else if (localEntry) {
        // Variable exists but is not callable
        const t = expr.token;
        errors.push(new MapleError(`'${expr.func}' is not callable`, t.line, t.col));
      } else {
        // imported function — check count only (no Maple-level param types available)
        const imp = meta.imports[expr.func];
        if (imp?.info?.kind === "func") {
          const paramChars = imp.info.signature.split("_")[0] ?? "";
          const expectedCount = paramChars === "v" ? 0 : paramChars.length;
          if (expr.args.length !== expectedCount) {
            const t = expr.token;
            errors.push(
              new MapleError(
                `Function '${expr.func}' expects ${expectedCount} arguments, got ${expr.args.length}`,
                t.line,
                t.col,
              ),
            );
          }
        }
      }
    }
    return;
  }

  // Check 5 — struct member existence (arrays only expose len/data)
  if (expr instanceof MemberExpression || expr instanceof PointerMemberExpression) {
    const parentType = resolveExprType(expr.parent, scope, meta, errors);
    if (parentType) {
      if (parentType.endsWith("[]")) {
        if (expr.member !== "len" && expr.member !== "data") {
          const t = expr.token;
          errors.push(new MapleError(`Array type has no member '${expr.member}'`, t.line, t.col));
        }
      } else {
        const structName = parentType.startsWith("*") ? parentType.slice(1) : parentType;
        const structDef = meta.structs[structName];
        if (structDef && !(expr.member in structDef.members)) {
          const t = expr.token;
          errors.push(
            new MapleError(`Struct '${structName}' has no member '${expr.member}'`, t.line, t.col),
          );
        }
      }
    }
    walkExpression(expr.parent, scope, meta, errors);
    return;
  }

  // Check 6 — const mutation (via AssignmentExpression)
  if (expr instanceof AssignmentExpression) {
    const name = getMutatedBindingName(expr.left);
    if (name !== null) {
      const imp = meta.imports[name];
      if (imp?.info?.kind === "global") {
        const t = expr.token;
        errors.push(new MapleError("cannot assign to imported global", t.line, t.col));
      } else {
        const entry = scope.get(name);
        if (entry && !entry.mutable) {
          const t = expr.token;
          errors.push(new MapleError(`Cannot assign to constant '${name}'`, t.line, t.col));
        }
      }
    }
    const targetType = resolveExprType(expr.left, scope, meta, errors);
    const assignedValue = expr.value;
    walkExpression(expr.left, scope, meta, errors);
    walkExpression(assignedValue, scope, meta, errors, targetType ?? undefined);
    const valueType = assignedValue ? resolveExprType(assignedValue, scope, meta, errors) : null;
    const compoundOperator = expr.operator.endsWith("=") ? expr.operator.slice(0, -1) : null;
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
    return;
  }

  if (expr instanceof StructLiteralExpression) {
    const sd = meta.structs[expr.name];
    if (!sd) return;

    for (const fieldName of Object.keys(expr.members)) {
      if (!(fieldName in sd.members)) {
        const t = expr.token;
        errors.push(
          new MapleError(`Struct '${expr.name}' has no field '${fieldName}'`, t.line, t.col),
        );
      }
    }

    for (const fieldName of Object.keys(sd.members)) {
      if (!(fieldName in expr.members)) {
        const t = expr.token;
        errors.push(
          new MapleError(
            `Struct '${expr.name}' field '${fieldName}' is not initialized`,
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
            `Struct '${expr.name}' field '${fieldName}': expected '${memberMeta.type}', got '${fieldType}'`,
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

    const elementTypes: string[] = [];
    for (const element of expr.elements) {
      let elementType: string;
      if (element instanceof IntegerLiteralExpression) elementType = "i32";
      else if (element instanceof FloatLiteralExpression) elementType = "f32";
      else if (element instanceof BooleanLiteralExpression) elementType = "bool";
      else if (element instanceof StringLiteralExpression) elementType = "string";
      else {
        errors.push(
          new MapleError(
            "array literal elements must be literals (expressions are not supported yet)",
            element.token.line,
            element.token.col,
          ),
        );
        continue;
      }
      elementTypes.push(elementType);
    }

    if (elementTypes.length !== expr.elements.length) return;
    const firstType = elementTypes[0];
    const mixedType = elementTypes.find((elementType) => elementType !== firstType);
    if (firstType !== undefined && mixedType !== undefined) {
      errors.push(
        new MapleError(
          `array literal has mixed element types: '${firstType}' and '${mixedType}'`,
          expr.token.line,
          expr.token.col,
        ),
      );
      return;
    }

    if (firstType !== undefined) {
      const integerAdoption = firstType === "i32" && integerRange(expr.memberType) !== null;
      const floatAdoption =
        firstType === "f32" && (expr.memberType === "f32" || expr.memberType === "f64");
      if (
        !integerAdoption &&
        !floatAdoption &&
        !typesCompatible(expr.memberType, firstType, meta)
      ) {
        errors.push(
          new MapleError(
            `array literal of '${firstType}' elements cannot initialize '${expr.memberType}[]'`,
            expr.token.line,
            expr.token.col,
          ),
        );
        return;
      }
    }

    for (const element of expr.elements) {
      if (element instanceof FloatLiteralExpression && expr.memberType === "f64") {
        element.numericType = "f64";
      }
      walkExpression(element, scope, meta, errors, expr.memberType);
    }
    return;
  }

  // Recurse into sub-expressions
  if (expr instanceof PrefixExpression) {
    walkExpression(expr.right, scope, meta, errors, expectedType);
  } else if (expr instanceof PostfixExpression) {
    walkExpression(expr.left, scope, meta, errors);
  } else if (expr instanceof CastExpression) {
    if (expr.expr instanceof IntegerLiteralExpression) {
      if (integerRange(expr.targetType)) {
        expr.expr.numericType = expr.targetType.endsWith("64") ? "i64" : "i32";
      }
    } else {
      walkExpression(expr.expr, scope, meta, errors);
    }
  } else if (expr instanceof IndexExpression) {
    walkExpression(expr.left, scope, meta, errors);
    walkExpression(expr.index, scope, meta, errors, "i32");
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
  if (stmt.expression === null) return;
  walkExpression(stmt.expression, scope, meta, errors, stmt.typeAnnotation);
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
      walkExpression(rhs, scope, meta, errors);
      const returnTypes = getCallReturnTypes(meta, rhs.func, scope);
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
        scope.set(name.value, { type: returnTypes[i] ?? "i32", mutable: stmt.mutable });
      }
      return;
    }

    // Add to scope before checking the initializer so later statements in the
    // same block can reference this name as soon as it is declared.
    scope.set(stmt.identifier.tokenLiteral(), {
      type: stmt.typeAnnotation,
      mutable: stmt.mutable,
    });
    // Check 1 — assignment type compatibility
    checkLetInitializer(stmt, scope, meta, errors);
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
      const passTypes = getCallReturnTypes(meta, returnValues[0].func, scope);
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
        walkExpression(returnValues[0], scope, meta, errors);
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
    walkExpression(stmt.expression, scope, meta, errors);
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
    if (!(stmt.initBlock.pattern instanceof TuplePattern)) {
      loopScope.set(stmt.initBlock.identifier.tokenLiteral(), {
        type: stmt.initBlock.typeAnnotation,
        mutable: stmt.initBlock.mutable,
      });
    }
    const loopCtx: FlowContext = { loopDepth: ctx.loopDepth + 1, switchDepth: ctx.switchDepth };
    // Check 1 for for-loop initializer
    checkLetInitializer(stmt.initBlock, loopScope, meta, errors);
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
    walkExpression(stmt.updateExpr.expression, loopScope, meta, errors);
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

export function typeCheck(program: ASTProgram, meta: ModuleMeta): MapleError[] {
  const errors: MapleError[] = [];

  // Build global scope: stdlib imported globals first, then top-level lets, then functions
  const globals: Scope = new Map();
  for (const [id, imp] of Object.entries(meta.imports)) {
    if (imp.info?.kind === "global") {
      globals.set(id, { type: imp.info.type, mutable: false });
    }
  }
  for (const stmt of program.statements) {
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
      });
    }
  }
  // All user-defined functions are callable values (fn-type)
  for (const [fnName, fnMeta] of Object.entries(meta.functions)) {
    const paramTypes = fnMeta.params.map((p) => p.type);
    const results = fnMeta.mapleResults;
    const key = canonicalFnType(paramTypes, results);
    globals.set(fnName, { type: key, mutable: false });
  }

  // Check top-level globals (Check 1)
  for (const stmt of program.statements) {
    if (stmt instanceof LetStatement && stmt.expression !== null) {
      if (stmt.pattern instanceof TuplePattern) continue;
      checkLetInitializer(stmt, globals, meta, errors);
    }
  }

  // Check each function body
  for (const stmt of program.statements) {
    if (!(stmt instanceof FunctionStatement)) continue;
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
      });
    }

    const fnReturnTypes = stmt.fnExpr.returnTypes;
    walkBlock(stmt.fnExpr.body, scope, meta, fnReturnTypes, errors);
  }

  return errors;
}
