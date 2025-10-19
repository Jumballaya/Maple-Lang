import type { Token } from "./token.types";

export const isLetter = (char: string): boolean => {
  return /[a-zA-Z_]/.test(char);
};

export const isDigit = (char: string): boolean => {
  return /[0-9]/.test(char);
};

export const isWhitespace = (char: string): boolean => {
  return char === " " || char === "\n" || char === "\t";
};

export const isInt = (word: string): boolean => {
  return /^[0-9]+$/.test(word);
};

export const isFloat = (word: string): boolean => {
  return /^[0-9]+\.[0-9]+$/.test(word);
};

export const isIdentifier = (word: string): boolean => {
  return /^[a-zA-Z_][a-zA-Z0-9_\-]*$/.test(word);
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
