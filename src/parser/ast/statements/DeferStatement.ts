import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { CallExpression } from "../expressions/CallExpression";
import type { ASTStatement } from "../types/ast.type";

/**
 * `defer f(args);` — the call runs when the innermost enclosing block is left
 * by any edge. The grammar admits exactly one call, so `call` is never null
 * and no walker needs to guard it.
 */
export class DeferStatement implements ASTStatement {
  public readonly type = "statement";
  public token: Token;
  public readonly call: CallExpression;

  constructor(token: Token, call: CallExpression) {
    this.token = token;
    this.call = call;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    return `defer ${this.call.toString()};`;
  }
}
