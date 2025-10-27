import { IfStatement } from "../../../parser/ast/statements/IfStatement";
import { ASTStatement } from "../../../parser/ast/types/ast.type.js";

export function stmtDefinitelyReturns(stmt: ASTStatement): boolean {
  switch (stmt.type) {
    case "return": {
      return true;
    }
    case "block": {
      for (let s of stmt.body) {
        if (stmtDefinitelyReturns(s)) {
          return true;
        }
      }
      return false;
    }
    case "if": {
      const thenHas = stmtDefinitelyReturns(stmt.thenBlock);
      const elseHas = stmt.elseBlock
        ? stmtDefinitelyReturns(stmt.elseBlock)
        : false;
      return thenHas && elseHas;
    }

    case "for": {
      return stmtDefinitelyReturns(stmt.body);
    }

    case "while": {
      return stmtDefinitelyReturns(stmt.body);
    }

    case "function": {
      return stmtDefinitelyReturns(stmt.body);
    }

    case "switch": {
      if (stmt.default && stmtDefinitelyReturns(stmt.default)) {
        return true;
      }
      return stmt.cases.some((c) => stmtDefinitelyReturns(c.body));
    }

    default: {
      return false;
    }
  }
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
