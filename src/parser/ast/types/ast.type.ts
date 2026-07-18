import type { Token } from "../../../lexer/token.types";

export type ASTNode = ASTStatement | ASTExpression;

export type ASTStatement = {
  type: "statement";
  token: Token;
  tokenLiteral(): string;
  toString(): string;
};

export type ResolvedDecl = {
  kind: "local" | "param" | "global" | "function" | "import" | "intrinsic";
  name: string;
};

export type ResolvedCallTarget =
  | { kind: "decl" }
  | {
      kind: "field";
      receiverArg: 0;
      structIdentity: string;
      member: string;
      fnType: string;
    };

export type ASTExpression = {
  type: "expression";
  token: Token;
  resolvedType?: string;
  resolvedResultTypes?: string[];
  resolvedDecl?: ResolvedDecl;
  resolvedCallTarget?: ResolvedCallTarget;
  tokenLiteral(): string;
  toString(): string;
};

export type PrefixParseFn = () => ASTExpression | null;

export type InfixParseFn = (expr: ASTExpression) => ASTExpression | null;

export type PostfixParseFn = (expr: ASTExpression) => ASTExpression | null;
