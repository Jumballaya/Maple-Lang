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
