import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { ASTExpression } from "../types/ast.type";

export class IntegerLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public value: number;
  public bigValue: bigint;
  /** Set by parser when a typed context uses a 64-bit integer lane (e.g. `let x: i64 = 1`). */
  public numericType: "i32" | "i64" = "i32";

  constructor(token: Token, value: number, rawText?: string) {
    this.token = token;
    this.bigValue = rawText === undefined ? BigInt(value) : BigInt(rawText);
    this.value = Number(this.bigValue);
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    return this.bigValue.toString();
  }

  public negate(): void {
    this.bigValue = -this.bigValue;
    this.value = Number(this.bigValue);
  }

  /**
   * Exact textual representation of this literal at the requested lane,
   * suitable for `(<lane>.const N)` emission. Truncates to the lane width
   * using two's-complement semantics so a u64 literal like
   * 0xFFFFFFFFFFFFFFFF becomes `-1` for the i64 lane.
   */
  public constText(lane: "i32" | "i64"): string {
    const sized =
      lane === "i64" ? BigInt.asIntN(64, this.bigValue) : BigInt.asIntN(32, this.bigValue);
    return sized.toString();
  }
}
