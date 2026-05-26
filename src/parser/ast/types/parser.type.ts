export type ParserPrecedence =
  | typeof LOWEST
  | typeof ASSIGN
  | typeof LOGICAL_OR
  | typeof LOGICAL_AND
  | typeof BIT_OR
  | typeof BIT_XOR
  | typeof BIT_AND
  | typeof COMPARE
  | typeof EQUALS
  | typeof LESSGREATER
  | typeof SHIFT
  | typeof SUM
  | typeof PRODUCT
  | typeof CAST
  | typeof PREFIX
  | typeof CALL
  | typeof INDEX;

// Precedence levels, lowest to highest. Mirrors C's relative ordering so
// `n < a && n < b` parses as `(n < a) && (n < b)`, not as `((n < a) && n) < b`.
export const LOWEST = 0;
export const ASSIGN = 1;
export const LOGICAL_OR = 2;
export const LOGICAL_AND = 3;
export const BIT_OR = 4;
export const BIT_XOR = 5;
export const BIT_AND = 6;
export const EQUALS = 7;
export const COMPARE = 8;
export const LESSGREATER = 8;
export const SHIFT = 9;
export const SUM = 10;
export const PRODUCT = 11;
export const CAST = 12;
export const PREFIX = 13;
export const CALL = 14;
export const INDEX = 15;
