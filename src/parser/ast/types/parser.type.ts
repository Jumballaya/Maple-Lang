export type ParserPrecedence =
  | typeof LOWEST
  | typeof COMPARE
  | typeof EQUALS
  | typeof LESSGREATER
  | typeof SUM
  | typeof PRODUCT
  | typeof PREFIX
  | typeof CALL
  | typeof INDEX
  | typeof ASSIGN;

export const LOWEST = 0;
export const COMPARE = 1;
export const EQUALS = 2;
export const LESSGREATER = 3;
export const SUM = 4;
export const PRODUCT = 5;
export const PREFIX = 6;
export const CALL = 7;
export const INDEX = 8;
export const ASSIGN = 9;
