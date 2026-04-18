import type { Token } from "../../../lexer/token.types";

export type TuplePatternName =
  | { kind: "name"; value: string; token: Token }
  | { kind: "discard"; token: Token };

export class TuplePattern {
  public readonly token: Token;
  public readonly names: TuplePatternName[];

  constructor(token: Token, names: TuplePatternName[]) {
    this.token = token;
    this.names = names;
  }

  public tokenLiteral(): string {
    return this.token.literal.toString();
  }

  public toString(): string {
    const parts = this.names.map((n) => (n.kind === "discard" ? "_" : n.value));
    return `(${parts.join(", ")})`;
  }
}
