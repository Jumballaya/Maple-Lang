import type { Token } from "./token.types";

export const isLetter = (char: string): boolean => {
  return /[a-zA-Z_]/.test(char);
};

export const isDigit = (char: string): boolean => {
  return /[0-9]/.test(char);
};

const decoder = new TextDecoder();
export const extractTokenLiteral = (token: Token): string => {
  const { literal } = token;
  if (typeof literal === "number") {
    return literal.toString();
  }
  if (literal instanceof Uint8Array) {
    return decoder.decode(literal);
  }
  return literal;
};
