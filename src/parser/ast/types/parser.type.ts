export type ParserPrecedence =
  | typeof LOWEST
  | typeof EQUALS
  | typeof LESSGREATER
  | typeof SUM
  | typeof PRODUCT
  | typeof PREFIX
  | typeof CALL;

export const LOWEST = 0;
export const EQUALS = 1;
export const LESSGREATER = 2;
export const SUM = 3;
export const PRODUCT = 4;
export const PREFIX = 5;
export const CALL = 6;