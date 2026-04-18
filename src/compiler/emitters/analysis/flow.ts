import { BlockStatement } from "../../../parser/ast/statements/BlockStatement";
import { ForStatement } from "../../../parser/ast/statements/ForStatement";
import { FunctionStatement } from "../../../parser/ast/statements/FunctionStatement";
import { IfStatement } from "../../../parser/ast/statements/IfStatement";
import { ReturnStatement } from "../../../parser/ast/statements/ReturnStatement";
import { SwitchStatement } from "../../../parser/ast/statements/SwitchStatement";
import { WhileStatement } from "../../../parser/ast/statements/WhileStatement";
import type { ASTStatement } from "../../../parser/ast/types/ast.type";
import type { ModuleEmitter } from "../../ModuleEmitter";
import { valueTypeToWasm } from "../emit.types";

export function stmtDefinitelyReturns(stmt: ASTStatement): boolean {
  if (stmt instanceof ReturnStatement) {
    return true;
  }
  if (stmt instanceof BlockStatement) {
    for (const s of stmt.statements) {
      if (stmtDefinitelyReturns(s)) {
        return true;
      }
    }
    return false;
  }
  if (stmt instanceof IfStatement) {
    const thenHas = stmtDefinitelyReturns(stmt.thenBlock);
    const elseHas = stmt.elseBlock ? stmtDefinitelyReturns(stmt.elseBlock) : false;
    return thenHas && elseHas;
  }

  if (stmt instanceof ForStatement) {
    // A loop may execute zero times (condition false on first check),
    // so it never "definitely" returns.
    return false;
  }

  if (stmt instanceof WhileStatement) {
    // Same reasoning: the loop body may never run.
    return false;
  }

  if (stmt instanceof FunctionStatement) {
    return stmtDefinitelyReturns(stmt.fnExpr.body);
  }

  if (stmt instanceof SwitchStatement) {
    // A switch only definitely returns when all reachable branches return:
    // every case body must definitely return and a default must exist + return.
    if (!stmt.default) {
      return false;
    }
    if (!stmtDefinitelyReturns(stmt.default)) {
      return false;
    }
    return stmt.cases.every((c) => stmtDefinitelyReturns(c.body));
  }
  return false;
}

export function extractNeedsReturn(stmt: IfStatement): boolean {
  const t = stmt.thenBlock;
  const e = stmt.elseBlock;

  const thenReturns = stmtDefinitelyReturns(t);
  if (e !== undefined) {
    const elseReturns = stmtDefinitelyReturns(e);
    return thenReturns && elseReturns;
  }
  return false;
}

type IfResultType = "i32" | "f32" | "i64" | "f64";

function mergeResultTypes(a: IfResultType | null, b: IfResultType | null): IfResultType | null {
  if (a === "f64" || b === "f64") return "f64";
  if (a === "f32" || b === "f32") return "f32";
  if (a === "i64" || b === "i64") return "i64";
  if (a === "i32" || b === "i32") return "i32";
  return null;
}

// Walk any statement shape and aggregate value-return types.
// Returns null when no value-bearing return statements are found.
function findStatementReturnType(stmt: ASTStatement, emitter: ModuleEmitter): IfResultType | null {
  if (stmt instanceof ReturnStatement) {
    if (stmt.returnValues.length === 0) return null;
    if (stmt.returnValues.length > 1) {
      throw new Error("if-as-expression cannot terminate with a multi-return");
    }
    const t = emitter.getExprType(stmt.returnValues[0]!);
    if (t === null) return null;
    const w = valueTypeToWasm(t);
    if (w === "f64" || w === "f32" || w === "i64" || w === "i32") return w;
    return "i32";
  }

  if (stmt instanceof BlockStatement) {
    let acc: IfResultType | null = null;
    for (const s of stmt.statements) {
      acc = mergeResultTypes(acc, findStatementReturnType(s, emitter));
    }
    return acc;
  }

  if (stmt instanceof IfStatement) {
    return mergeResultTypes(
      findStatementReturnType(stmt.thenBlock, emitter),
      stmt.elseBlock ? findStatementReturnType(stmt.elseBlock, emitter) : null,
    );
  }

  if (stmt instanceof SwitchStatement) {
    let acc: IfResultType | null = stmt.default
      ? findStatementReturnType(stmt.default, emitter)
      : null;
    for (const c of stmt.cases) {
      acc = mergeResultTypes(acc, findStatementReturnType(c.body, emitter));
    }
    return acc;
  }

  if (stmt instanceof ForStatement) {
    return findStatementReturnType(stmt.loopBody, emitter);
  }

  if (stmt instanceof WhileStatement) {
    return findStatementReturnType(stmt.loopBody, emitter);
  }

  if (stmt instanceof FunctionStatement) {
    return findStatementReturnType(stmt.fnExpr.body, emitter);
  }

  return null;
}

export function extractIfResultType(
  stmt: IfStatement,
  emitter: ModuleEmitter,
): IfResultType | null {
  return mergeResultTypes(
    findStatementReturnType(stmt.thenBlock, emitter),
    stmt.elseBlock ? findStatementReturnType(stmt.elseBlock, emitter) : null,
  );
}
