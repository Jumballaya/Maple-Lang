import { AssignmentExpression } from "../parser/ast/expressions/AssignmentExpression";
import { BooleanLiteralExpression } from "../parser/ast/expressions/BooleanLiteralExpression";
import { CallExpression } from "../parser/ast/expressions/CallExpression";
import { CastExpression } from "../parser/ast/expressions/CastExpression";
import { FloatLiteralExpression } from "../parser/ast/expressions/FloatLiteralExpression";
import { Identifier } from "../parser/ast/expressions/Identifier";
import { IndexExpression } from "../parser/ast/expressions/IndexExpression";
import { InfixExpression } from "../parser/ast/expressions/InfixExpression";
import { IntegerLiteralExpression } from "../parser/ast/expressions/IntegerLiteral";
import { MemberExpression } from "../parser/ast/expressions/MemberExpression";
import { PointerMemberExpression } from "../parser/ast/expressions/PointerMemberExpression";
import { PostfixExpression } from "../parser/ast/expressions/PostfixExpression";
import { PrefixExpression } from "../parser/ast/expressions/PrefixExpression";
import type { ASTExpression, ASTStatement } from "../parser/ast/types/ast.type";
import type { ASTProgram } from "../parser/ast/ASTProgram";
import { BlockStatement } from "../parser/ast/statements/BlockStatement";
import { ExpressionStatement } from "../parser/ast/statements/ExpressionStatement";
import { ForStatement } from "../parser/ast/statements/ForStatement";
import { FunctionStatement } from "../parser/ast/statements/FunctionStatement";
import { IfStatement } from "../parser/ast/statements/IfStatement";
import { LetStatement } from "../parser/ast/statements/LetStatement";
import { ReturnStatement } from "../parser/ast/statements/ReturnStatement";
import { WhileStatement } from "../parser/ast/statements/WhileStatement";
import { MapleError } from "./errors";
import { baseScalar, cmpOps, valueTypeToWasm } from "./emitters/emit.types";
import type { ModuleMeta } from "./emitters/emitter.types";

const ARITHMETIC_OPS = new Set(["+", "-", "*", "/", "%"]);

// ─── Scope ────────────────────────────────────────────────────────────────────

type ScopeEntry = { type: string; mutable: boolean };
type Scope = Map<string, ScopeEntry>;

// ─── Expression type resolver ─────────────────────────────────────────────────
//
// Returns the Maple-level type string (e.g. "i32", "f32", "bool", "Point",
// "i32[]") or null when the type cannot be statically determined.  Returning
// null means "skip this check" — the emitter will surface the error later.

function resolveExprType(expr: ASTExpression, scope: Scope, meta: ModuleMeta): string | null {
  if (expr instanceof IntegerLiteralExpression) return "i32";
  if (expr instanceof FloatLiteralExpression) return "f32";
  if (expr instanceof BooleanLiteralExpression) return "bool";

  if (expr instanceof Identifier) {
    return scope.get(expr.tokenLiteral())?.type ?? null;
  }

  if (expr instanceof CastExpression) {
    return expr.targetType;
  }

  if (expr instanceof InfixExpression) {
    if (cmpOps.has(expr.operator)) return "bool";
    const lt = resolveExprType(expr.left, scope, meta);
    const rt = resolveExprType(expr.right, scope, meta);
    if (lt === null || rt === null) return null;
    if (valueTypeToWasm(lt) === "f32" || valueTypeToWasm(rt) === "f32") return "f32";
    return "i32";
  }

  if (expr instanceof PrefixExpression) {
    if (expr.operator === "!") return "bool";
    if (expr.operator === "~") return "i32";
    if (expr.operator === "-") {
      return expr.right ? resolveExprType(expr.right, scope, meta) : "i32";
    }
    return "i32";
  }

  if (expr instanceof PostfixExpression) {
    return expr.left ? resolveExprType(expr.left, scope, meta) : "i32";
  }

  if (expr instanceof CallExpression) {
    const fn = meta.functions[expr.func];
    if (fn) return fn.result === "void" ? "void" : fn.result;
    const imp = meta.imports[expr.func];
    if (imp?.info?.kind === "func") {
      const resultChar = imp.info.signature.split("_")[1]?.[0];
      if (resultChar === "f") return "f32";
      if (resultChar === "v") return "void";
      return "i32";
    }
    return null;
  }

  if (expr instanceof IndexExpression) {
    const containerType = resolveExprType(expr.left, scope, meta);
    if (!containerType) return null;
    if (!(containerType.endsWith("[]") || containerType.startsWith("*"))) return null;
    return baseScalar(containerType);
  }

  if (expr instanceof MemberExpression || expr instanceof PointerMemberExpression) {
    const parentType = resolveExprType(expr.parent, scope, meta);
    if (!parentType) return null;
    const structName = parentType.startsWith("*") ? parentType.slice(1) : parentType;
    const memberData = meta.structs[structName]?.members[expr.member];
    return memberData?.type ?? null;
  }

  if (expr instanceof AssignmentExpression) {
    return resolveExprType(expr.left, scope, meta);
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

  // Check 3 — mixed arithmetic
  if (expr instanceof InfixExpression) {
    if (ARITHMETIC_OPS.has(expr.operator)) {
      const lt = resolveExprType(expr.left, scope, meta);
      const rt = resolveExprType(expr.right, scope, meta);
      if (lt !== null && rt !== null) {
        const leftIsF32 = valueTypeToWasm(lt) === "f32";
        const rightIsF32 = valueTypeToWasm(rt) === "f32";
        if (leftIsF32 !== rightIsF32) {
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
          const argType = resolveExprType(expr.args[i]!, scope, meta);
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
    for (const arg of expr.args) walkExpression(arg, scope, meta, errors);
    return;
  }

  // Check 5 — struct member existence
  if (expr instanceof MemberExpression || expr instanceof PointerMemberExpression) {
    const parentType = resolveExprType(expr.parent, scope, meta);
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
      const entry = scope.get(name);
      if (entry && !entry.mutable) {
        const t = expr.token;
        errors.push(new MapleError(`Cannot assign to constant '${name}'`, t.line, t.col));
      }
    }
    walkExpression(expr.left, scope, meta, errors);
    walkExpression(expr.value, scope, meta, errors);
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
  const actualType = resolveExprType(stmt.expression, scope, meta);
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

function walkBlock(
  block: BlockStatement,
  scope: Scope,
  meta: ModuleMeta,
  fnReturnType: string | null,
  errors: MapleError[],
): void {
  for (const stmt of block.statements) {
    walkStatement(stmt, scope, meta, fnReturnType, errors);
  }
}

function walkStatement(
  stmt: ASTStatement,
  scope: Scope,
  meta: ModuleMeta,
  fnReturnType: string | null,
  errors: MapleError[],
): void {
  if (stmt instanceof LetStatement) {
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
    // Check 2 — return type
    const isVoid = fnReturnType === null || fnReturnType === "void";
    if (isVoid && stmt.returnValue !== null) {
      const t = stmt.token;
      errors.push(new MapleError("Cannot return a value from a void function", t.line, t.col));
    } else if (!isVoid && stmt.returnValue === null) {
      const t = stmt.token;
      errors.push(
        new MapleError(`Function must return a value of type '${fnReturnType}'`, t.line, t.col),
      );
    } else if (!isVoid && stmt.returnValue !== null) {
      const actualType = resolveExprType(stmt.returnValue, scope, meta);
      if (actualType !== null && !typesCompatible(fnReturnType!, actualType, meta)) {
        const t = stmt.token;
        errors.push(
          new MapleError(
            `Return type mismatch: expected '${fnReturnType}', got '${actualType}'`,
            t.line,
            t.col,
          ),
        );
      }
      walkExpression(stmt.returnValue, scope, meta, errors);
    }
    return;
  }

  if (stmt instanceof ExpressionStatement) {
    walkExpression(stmt.expression, scope, meta, errors);
    return;
  }

  if (stmt instanceof IfStatement) {
    walkExpression(stmt.conditionExpr, scope, meta, errors);
    walkBlock(stmt.thenBlock, scope, meta, fnReturnType, errors);
    if (stmt.elseBlock) {
      walkBlock(stmt.elseBlock, scope, meta, fnReturnType, errors);
    }
    return;
  }

  if (stmt instanceof WhileStatement) {
    walkExpression(stmt.condExpr, scope, meta, errors);
    walkBlock(stmt.loopBody, scope, meta, fnReturnType, errors);
    return;
  }

  if (stmt instanceof ForStatement) {
    // add the init variable to scope
    scope.set(stmt.initBlock.identifier.tokenLiteral(), {
      type: stmt.initBlock.typeAnnotation,
      mutable: stmt.initBlock.mutable,
    });
    // Check 1 for for-loop initializer
    checkLetInitializer(stmt.initBlock, scope, meta, errors);
    walkExpression(stmt.conditionExpr.expression, scope, meta, errors);
    walkExpression(stmt.updateExpr.expression, scope, meta, errors);
    walkBlock(stmt.loopBody, scope, meta, fnReturnType, errors);
    return;
  }

  if (stmt instanceof BlockStatement) {
    walkBlock(stmt, scope, meta, fnReturnType, errors);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function typeCheck(program: ASTProgram, meta: ModuleMeta): MapleError[] {
  const errors: MapleError[] = [];

  // Build global scope from top-level LetStatements (preserving Maple types)
  const globals: Scope = new Map();
  for (const stmt of program.statements) {
    if (stmt instanceof LetStatement) {
      globals.set(stmt.identifier.tokenLiteral(), {
        type: stmt.typeAnnotation,
        mutable: stmt.mutable,
      });
    }
  }

  // Check top-level globals (Check 1)
  for (const stmt of program.statements) {
    if (stmt instanceof LetStatement && stmt.expression !== null) {
      checkLetInitializer(stmt, globals, meta, errors);
    }
  }

  // Check each function body
  for (const stmt of program.statements) {
    if (!(stmt instanceof FunctionStatement)) continue;

    // Build per-function scope: globals + params
    const scope: Scope = new Map(globals);
    for (const param of stmt.fnExpr.params) {
      scope.set(param.identifier.tokenLiteral(), {
        type: param.type,
        mutable: false,
      });
    }

    const fnReturnType = stmt.fnExpr.returnType ?? null;
    walkBlock(stmt.fnExpr.body, scope, meta, fnReturnType, errors);
  }

  return errors;
}
