import { extractTokenLiteral } from "../../../lexer/lexer.utils";
import type { Token } from "../../../lexer/token.types";
import type { ASTExpression } from "../types/ast.type";

export class IntegerLiteralExpression implements ASTExpression {
  public readonly type = "expression";
  public token: Token;
  public value: number;
  /** Set by parser when a typed context uses a 64-bit integer lane (e.g. `let x: i64 = 1`). */
  public numericType: "i32" | "i64" = "i32";

  // Original source lexeme (e.g. "0xFFFFFFFFFFFFFFFF", "42", "0b1010"),
  // retained so `constText` can reconstruct an exact decimal repr for
  // literals beyond JS Number's safe range.
  private readonly rawText: string | undefined;

  constructor(token: Token, value: number, rawText?: string) {
    this.token = token;
    this.value = value;
    this.rawText = rawText;
  }

  public tokenLiteral(): string {
    return extractTokenLiteral(this.token);
  }

  public toString(): string {
    return this.value.toString();
  }

  /**
   * Exact textual representation of this literal at the requested lane,
   * suitable for `(<lane>.const N)` emission. Truncates to the lane width
   * using two's-complement semantics so a u64 literal like
   * 0xFFFFFFFFFFFFFFFF becomes `-1` for the i64 lane.
   */
  public constText(lane: "i32" | "i64"): string {
    if (this.rawText !== undefined) {
      try {
        const big = BigInt(this.rawText);
        const sized = lane === "i64" ? BigInt.asIntN(64, big) : BigInt.asIntN(32, big);
        return sized.toString();
      } catch {
        // Fall through to the JS-number representation below.
      }
    }
    return this.value.toString();
  }
}
