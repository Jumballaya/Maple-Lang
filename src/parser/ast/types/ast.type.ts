export type ASTNode = ASTStatement | ASTExpression;

export type ASTStatement = {
  type: "statement";
  tokenLiteral(): string;
  toString(): string;
};

export type ASTExpression = {
  type: "expression";
  tokenLiteral(): string;
  toString(): string;
};

export type PrefixParseFn = {
  (): ASTExpression | null;
};

export type InfixParseFn = {
  (expr: ASTExpression): ASTExpression | null;
};

export type PostfixParseFn = {
  (expr: ASTExpression): ASTExpression | null;
};
