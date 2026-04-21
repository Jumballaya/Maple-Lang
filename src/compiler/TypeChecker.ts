import type { ASTProgram } from "../parser/ast/ASTProgram";
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
    const wl = valueTypeToWasm(lt);
    const wr = valueTypeToWasm(rt);
    if (wl === "f32" || wl === "f64" || wr === "f32" || wr === "f64") {
      if (wl === "f64" || wr === "f64") return "f64";
      return "f32";
    }
    if (wl === "i64" || wr === "i64") {
      if (isUnsignedMapleInteger(lt) && isUnsignedMapleInteger(rt)) return "u64";
      return "i64";
    }
    if (isUnsignedMapleInteger(lt) && isUnsignedMapleInteger(rt)) return "u32";
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

// ─── AST walkers ──────────────────────────────────────────────────────────────

function walkExpression(
  expr: ASTExpression | null,
  scope: Scope,
  meta: ModuleMeta,
  errors: MapleError[],
): void {
  if (!expr) return;

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
    if (ARITHMETIC_OPS.has(expr.operator)) {
      const lt = resolveExprType(expr.left, scope, meta, errors);
      const rt = resolveExprType(expr.right, scope, meta, errors);
      if (lt !== null && rt !== null) {
        if (valueTypeToWasm(lt) !== valueTypeToWasm(rt)) {
          const t = expr.token;
          errors.push(
            new MapleError(
              `Mixed types in arithmetic: '${lt}' and '${rt}' — use explicit cast`,
              t.line,
              t.col,
            ),
          );
        }
      }
    }
    if (BITWISE_OPS.has(expr.operator)) {
      const lt = resolveExprType(expr.left, scope, meta, errors);
      const rt = resolveExprType(expr.right, scope, meta, errors);
      const bad = (x: string | null) =>
        x !== null && (valueTypeToWasm(x) === "f32" || valueTypeToWasm(x) === "f64");
      if (bad(lt) || bad(rt)) {
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
    walkExpression(expr.left, scope, meta, errors);
    walkExpression(expr.right, scope, meta, errors);
    return;
  }

  // Check 4 — call argument count and types
  if (expr instanceof CallExpression) {
    const fn = meta.functions[expr.func];
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
    for (const arg of expr.args) walkExpression(arg, scope, meta, errors);
    return;
  }

  // Check 5 — struct member existence
  if (expr instanceof MemberExpression || expr instanceof PointerMemberExpression) {
    const parentType = resolveExprType(expr.parent, scope, meta, errors);
    if (parentType) {
      const structName = parentType.startsWith("*") ? parentType.slice(1) : parentType;
      const structDef = meta.structs[structName];
      if (structDef && !(expr.member in structDef.members)) {
        const t = expr.token;
        errors.push(
          new MapleError(`Struct '${structName}' has no member '${expr.member}'`, t.line, t.col),
        );
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
    walkExpression(expr.left, scope, meta, errors);
    walkExpression(expr.value, scope, meta, errors);
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
      walkExpression(fieldExpr, scope, meta, errors);
    }
    return;
  }

  // Recurse into sub-expressions
  if (expr instanceof PrefixExpression) {
    walkExpression(expr.right, scope, meta, errors);
  } else if (expr instanceof PostfixExpression) {
    walkExpression(expr.left, scope, meta, errors);
  } else if (expr instanceof CastExpression) {
    walkExpression(expr.expr, scope, meta, errors);
  } else if (expr instanceof IndexExpression) {
    walkExpression(expr.left, scope, meta, errors);
    walkExpression(expr.index, scope, meta, errors);
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
  walkExpression(stmt.expression, scope, meta, errors);
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
  for (const stmt of block.statements) {
    walkStatement(stmt, scope, meta, fnReturnTypes, errors, ctx);
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
      const actualType = resolveExprType(returnValues[i]!, scope, meta, errors);
      if (actualType === null) {
        walkExpression(returnValues[i]!, scope, meta, errors);
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
      walkExpression(returnValues[i]!, scope, meta, errors);
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
      if (w === "i64" || w === "f64") {
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
