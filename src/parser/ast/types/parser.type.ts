export type ParserPrecedence =
  | typeof LOWEST
  | typeof ASSIGN
  | typeof COMPARE
  | typeof EQUALS
  | typeof LESSGREATER
  | typeof SUM
  | typeof PRODUCT
  | typeof PREFIX
  | typeof CALL
  | typeof INDEX;

export const LOWEST = 0;
export const ASSIGN = 1;
export const COMPARE = 2;
export const EQUALS = 3;
export const LESSGREATER = 4;
export const SUM = 5;
export const PRODUCT = 6;
export const PREFIX = 7;
export const CALL = 8;
export const INDEX = 9;
