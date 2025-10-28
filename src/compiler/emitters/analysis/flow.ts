import { BlockStatement } from "../../../parser/ast/statements/BlockStatement";
import { ForStatement } from "../../../parser/ast/statements/ForStatement";
import { FunctionStatement } from "../../../parser/ast/statements/FunctionStatement";
import { IfStatement } from "../../../parser/ast/statements/IfStatement";
import { ReturnStatement } from "../../../parser/ast/statements/ReturnStatement";
import { SwitchStatement } from "../../../parser/ast/statements/SwitchStatement";
import { WhileStatement } from "../../../parser/ast/statements/WhileStatement";
import { ASTStatement } from "../../../parser/ast/types/ast.type.js";

export function stmtDefinitelyReturns(stmt: ASTStatement): boolean {
  if (stmt instanceof ReturnStatement) {
    return true;
  }
  if (stmt instanceof BlockStatement) {
    for (let s of stmt.statements) {
      if (stmtDefinitelyReturns(s)) {
        return true;
      }
    }
    return false;
  }
  if (stmt instanceof IfStatement) {
    const thenHas = stmtDefinitelyReturns(stmt.thenBlock);
    const elseHas = stmt.elseBlock
      ? stmtDefinitelyReturns(stmt.elseBlock)
      : false;
    return thenHas && elseHas;
  }

  if (stmt instanceof ForStatement) {
    return stmtDefinitelyReturns(stmt.loopBody);
  }

  if (stmt instanceof WhileStatement) {
    return stmtDefinitelyReturns(stmt.loopBody);
  }

  if (stmt instanceof FunctionStatement) {
    return stmtDefinitelyReturns(stmt.fnExpr.body);
  }

  if (stmt instanceof SwitchStatement) {
    if (stmt.default && stmtDefinitelyReturns(stmt.default)) {
      return true;
    }
    return stmt.cases.some((c) => stmtDefinitelyReturns(c.body));
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
