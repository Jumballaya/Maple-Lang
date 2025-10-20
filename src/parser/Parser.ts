import { Tokenizer } from "../lexer/Tokenizer";
import { extractTokenLiteral } from "../lexer/lexer.utils";
import { Token } from "../lexer/token.types";
import { ASTProgram } from "./ast/ASTProgram";
import { IntegerLiteralExpression } from "./ast/expressions/IntegerLiteral";
import {
  FunctionLiteralExpression,
  FunctionParameter,
} from "./ast/expressions/FunctionLiteralExpression";
import { Identifier } from "./ast/expressions/Identifier";
import { InfixExpression } from "./ast/expressions/InfixExpression";
import { BlockStatement } from "./ast/statements/BlockStatement";
import { ExpressionStatement } from "./ast/statements/ExpressionStatement";
import { FunctionStatement } from "./ast/statements/FunctionStatement";
import { LetStatement } from "./ast/statements/LetStatement";
import { ReturnStatement } from "./ast/statements/ReturnStatement";
import {
  ASTExpression,
  ASTStatement,
  InfixParseFn,
  PrefixParseFn,
} from "./ast/types/ast.type";

enum Precedence {
  LOWEST = 1,
  SUM,
  PRODUCT,
}

const PRECEDENCES: Record<string, Precedence> = {
  Plus: Precedence.SUM,
  Minus: Precedence.SUM,
  Star: Precedence.PRODUCT,
  Slash: Precedence.PRODUCT,
  Percent: Precedence.PRODUCT,
};

export class Parser {
  private tokenizer: Tokenizer;
  private curToken: Token;
  private peekToken: Token;
  private readonly prefixParseFns: Map<Token["type"], PrefixParseFn> = new Map();
  private readonly infixParseFns: Map<Token["type"], InfixParseFn> = new Map();

  constructor(source: string) {
    this.tokenizer = new Tokenizer(source);
    this.curToken = this.tokenizer.curToken();
    this.peekToken = this.tokenizer.peekToken();

    this.registerPrefix("Identifier", this.parseIdentifier.bind(this));
    this.registerPrefix(
      "IntegerLiteral",
      this.parseIntegerLiteral.bind(this)
    );

    this.registerInfix("Plus", this.parseInfixExpression.bind(this));
    this.registerInfix("Minus", this.parseInfixExpression.bind(this));
    this.registerInfix("Star", this.parseInfixExpression.bind(this));
    this.registerInfix("Slash", this.parseInfixExpression.bind(this));
    this.registerInfix("Percent", this.parseInfixExpression.bind(this));
  }

  public parse(): ASTProgram {
    const program = new ASTProgram("statement");

    while (!this.curTokenIs("EOF")) {
      const stmt = this.parseStatement();
      if (stmt) {
        program.statements.push(stmt);
      }
      this.nextToken();
    }

    return program;
  }

  private parseStatement(): ASTStatement | null {
    switch (this.curToken.type) {
      case "Let":
      case "Const":
        return this.parseLetStatement();
      case "Return":
        return this.parseReturnStatement();
      case "Func":
        return this.parseFunctionStatement();
      default:
        return this.parseExpressionStatement();
    }
  }

  private parseLetStatement(): ASTStatement | null {
    const token = this.curToken;

    if (!this.expectPeek("Identifier")) {
      return null;
    }

    const identifier = new Identifier(this.curToken);

    if (!this.expectPeek("Colon")) {
      return null;
    }

    this.nextToken();
    const typeAnnotation = extractTokenLiteral(this.curToken);

    if (!this.expectPeek("Assign")) {
      return null;
    }

    this.nextToken();
    const expression = this.parseExpression(Precedence.LOWEST);

    if (!this.expectPeek("Semicolon")) {
      return null;
    }

    return new LetStatement(token, identifier, typeAnnotation, expression);
  }

  private parseReturnStatement(): ReturnStatement {
    const token = this.curToken;
    const stmt = new ReturnStatement(token);

    if (this.peekTokenIs("Semicolon")) {
      this.nextToken();
      return stmt;
    }

    this.nextToken();
    stmt.returnValue = this.parseExpression(Precedence.LOWEST);

    if (this.peekTokenIs("Semicolon")) {
      this.nextToken();
    }

    return stmt;
  }

  private parseExpressionStatement(): ExpressionStatement {
    const stmt = new ExpressionStatement(this.curToken);
    stmt.expression = this.parseExpression(Precedence.LOWEST);

    if (this.peekTokenIs("Semicolon")) {
      this.nextToken();
    }

    return stmt;
  }

  private parseFunctionStatement(): ASTStatement | null {
    const token = this.curToken;

    if (!this.expectPeek("Identifier")) {
      return null;
    }

    const name = new Identifier(this.curToken);

    if (!this.expectPeek("LParen")) {
      return null;
    }

    const parameters = this.parseFunctionParameters();

    if (!this.curTokenIs("RParen")) {
      if (!this.expectPeek("RParen")) {
        return null;
      }
    }

    if (!this.expectPeek("Colon")) {
      return null;
    }

    this.nextToken();
    const returnType = extractTokenLiteral(this.curToken);

    if (!this.expectPeek("LBrace")) {
      return null;
    }

    const body = this.parseBlockStatement();

    const fnExpr = new FunctionLiteralExpression(token, {
      name,
      parameters,
      returnType,
      body,
    });
    return new FunctionStatement(token, name, fnExpr);
  }

  private parseFunctionParameters(): FunctionParameter[] {
    const params: FunctionParameter[] = [];

    if (this.peekTokenIs("RParen")) {
      this.nextToken();
      return params;
    }

    this.nextToken();

    while (true) {
      const ident = new Identifier(this.curToken);

      if (!this.expectPeek("Colon")) {
        return params;
      }

      this.nextToken();
      const typeAnnotation = extractTokenLiteral(this.curToken);

      params.push({ identifier: ident, typeAnnotation });

      if (!this.peekTokenIs("Comma")) {
        break;
      }

      this.nextToken();
      this.nextToken();
    }

    return params;
  }

  private parseBlockStatement(): BlockStatement {
    const token = this.curToken;
    const block = new BlockStatement(token, []);

    this.nextToken();

    while (!this.curTokenIs("RBrace") && !this.curTokenIs("EOF")) {
      const stmt = this.parseStatement();
      if (stmt) {
        block.statements.push(stmt);
      }
      this.nextToken();
    }

    return block;
  }

  private parseExpression(precedence: Precedence): ASTExpression | null {
    const prefix = this.prefixParseFns.get(this.curToken.type);
    if (!prefix) {
      return null;
    }

    let leftExp = prefix();

    while (!this.peekTokenIs("Semicolon") && precedence < this.peekPrecedence()) {
      const infix = this.infixParseFns.get(this.peekToken.type);
      if (!infix) {
        return leftExp;
      }

      this.nextToken();
      leftExp = infix(leftExp!);
    }

    return leftExp;
  }

  private parseIdentifier(): ASTExpression {
    return new Identifier(this.curToken);
  }

  private parseIntegerLiteral(): ASTExpression {
    return new IntegerLiteralExpression(this.curToken);
  }

  private parseInfixExpression(left: ASTExpression): ASTExpression {
    const token = this.curToken;
    const operator = extractTokenLiteral(token);
    const precedence = this.curPrecedence();
    this.nextToken();
    const right = this.parseExpression(precedence) ?? new Identifier(token);
    return new InfixExpression(token, operator, left, right);
  }

  private curTokenIs(type: Token["type"]): boolean {
    return this.curToken.type === type;
  }

  private peekTokenIs(type: Token["type"]): boolean {
    return this.peekToken.type === type;
  }

  private expectPeek(type: Token["type"]): boolean {
    if (this.peekTokenIs(type)) {
      this.nextToken();
      return true;
    }
    return false;
  }

  private registerPrefix(type: Token["type"], fn: PrefixParseFn): void {
    this.prefixParseFns.set(type, fn);
  }

  private registerInfix(type: Token["type"], fn: InfixParseFn): void {
    this.infixParseFns.set(type, fn);
  }

  private nextToken(): void {
    this.tokenizer.nextToken();
    this.curToken = this.tokenizer.curToken();
    this.peekToken = this.tokenizer.peekToken();
  }

  private peekPrecedence(): Precedence {
    return PRECEDENCES[this.peekToken.type] ?? Precedence.LOWEST;
  }

  private curPrecedence(): Precedence {
    return PRECEDENCES[this.curToken.type] ?? Precedence.LOWEST;
  }
}
