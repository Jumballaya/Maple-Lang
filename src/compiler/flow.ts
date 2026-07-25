import { BlockStatement } from "../parser/ast/statements/BlockStatement";
import { ForStatement } from "../parser/ast/statements/ForStatement";
import { FunctionStatement } from "../parser/ast/statements/FunctionStatement";
import { IfStatement } from "../parser/ast/statements/IfStatement";
import { ReturnStatement } from "../parser/ast/statements/ReturnStatement";
import { SwitchStatement } from "../parser/ast/statements/SwitchStatement";
import { WhileStatement } from "../parser/ast/statements/WhileStatement";
import type { ASTStatement } from "../parser/ast/types/ast.type";

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
