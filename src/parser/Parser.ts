import { FloatToken, IdentToken, Token } from "../lexer/token.types";
import { Tokenizer } from "../lexer/Tokenizer";
import { ASTProgram } from "./ast/ASTProgram";
import { BooleanLiteralExpression } from "./ast/expressions/BooleanLiteralExpression";
import { CallExpression } from "./ast/expressions/CallExpression";
import { FloatLiteralExpression } from "./ast/expressions/FloatLiteralExpression";
import { FunctionLiteralExpression, FunctionParam } from "./ast/expressions/FunctionLiteralExpression";
import { Identifier } from "./ast/expressions/Identifier";
import { InfixExpression } from "./ast/expressions/InfixExpression";
import { PrefixExpression } from "./ast/expressions/PrefixExpression";
import { BlockStatement } from "./ast/statements/BlockStatement";
import { ExpressionStatement } from "./ast/statements/ExpressionStatement";
import { IfStatement } from "./ast/statements/IfStatement";
import { LetStatement } from "./ast/statements/LetStatement";
import { ReturnStatement } from "./ast/statements/ReturnStatement";
import { ASTExpression, ASTStatement, InfixParseFn, PostfixParseFn, PrefixParseFn } from "./ast/types/ast.type";
import { CALL, EQUALS, LESSGREATER, LOWEST, ParserPrecedence, PREFIX, PRODUCT, SUM } from "./ast/types/parser.type";

export class Parser {
  private tokenizer: Tokenizer;
  private errors: string[] = [];


  private prefixParseFns: Map<Token['type'], PrefixParseFn> = new Map();
  private infixParseFns: Map<Token['type'], InfixParseFn> = new Map();
  private postfixParseFns: Map<Token['type'], PostfixParseFn> = new Map();

  private precendences: Partial<Record<Token['type'], ParserPrecedence>> = {
    Assign: EQUALS,
    NotEquals: EQUALS,
    LessThan: LESSGREATER,
    GreaterThan: LESSGREATER,
    Plus: SUM,
    Minus: SUM,
    Slash: PRODUCT,
    Star: PRODUCT,
    LParen: CALL,
  };

  constructor(source: string) {
    this.tokenizer = new Tokenizer(source);


    // Prefix
    this.registerPrefix('Identifier', this.parseIdentifier.bind(this));
    this.registerPrefix('FloatLiteral', this.parseFloatLiteral.bind(this));
    this.registerPrefix('Bang', this.parsePrefixExpression.bind(this));
    this.registerPrefix('Minus', this.parsePrefixExpression.bind(this));
    this.registerPrefix('True', this.parseBooleanLiteral.bind(this));
    this.registerPrefix('False', this.parseBooleanLiteral.bind(this));
    this.registerPrefix('LParen', this.parseGroupedExpression.bind(this));
    this.registerPrefix('Func', this.parseFunctionLiteral.bind(this));

    // Infix
    this.registerInfix('Plus', this.parseInfixExpression.bind(this));
    this.registerInfix('Minus', this.parseInfixExpression.bind(this));
    this.registerInfix('Slash', this.parseInfixExpression.bind(this));
    this.registerInfix('Star', this.parseInfixExpression.bind(this));
    this.registerInfix('Equals', this.parseInfixExpression.bind(this));
    this.registerInfix('NotEquals', this.parseInfixExpression.bind(this));
    this.registerInfix('LessThan', this.parseInfixExpression.bind(this));
    this.registerInfix('GreaterThan', this.parseInfixExpression.bind(this));
    this.registerInfix('LParen', this.parseCallExpression.bind(this));
  }

  public parse(name: string): ASTProgram {
    const program = new ASTProgram('expression', name);

    while (this.tokenizer.curToken().type !== 'EOF') {
      const statement = this.parseStatement();
      if (statement !== null) {
        program.statements.push(statement);
      }
      this.tokenizer.nextToken();
    }

    return program;
  }

  private parseStatement(): ASTStatement | null {
    switch (this.tokenizer.curToken().type) {
      case 'Let': {
        return this.parseLetStatement();
      }

      case 'Return': {
        return this.parseReturnStatement();
      }

      case 'If': {
        return this.parseIfStatement();
      }

      default: {
        return this.parseExpressionStatement();
      }
    }
  }

  private parseLetStatement(): ASTStatement | null {
    const statementToken = this.tokenizer.curToken();
    if (!this.expectPeek('Identifier')) {
      return null;
    }
    const identToken = this.tokenizer.curToken();

    let typeAnn = '';
    if (this.tokenizer.peekTokenIs('Colon')) {
      this.tokenizer.nextToken();
      const t = this.parseTypeNode();
      if (!t) return null;
      typeAnn = t;
    }
    const identifier = new Identifier(identToken, typeAnn);

    if (!this.expectPeek('Assign')) {
      return null;
    }

    this.tokenizer.nextToken();

    const value = this.parseExpression(LOWEST);

    if (this.tokenizer.peekTokenIs('Semicolon')) {
      this.tokenizer.nextToken();
    }

    const exported = true; // @TODO: properly parse export

    // @TODO: keep a map of ident types to use here
    const letStmt = new LetStatement(statementToken, identifier, '', value, exported);
    letStmt.typeAnnotation = typeAnn;
    return letStmt;
  }

  private parseReturnStatement(): ASTStatement | null {
    const statementToken = this.tokenizer.curToken();
    this.tokenizer.nextToken();

    const returnValue = this.parseExpression(LOWEST);

    if (this.tokenizer.peekTokenIs('Semicolon')) {
      this.tokenizer.nextToken();
    }

    return new ReturnStatement(statementToken, returnValue);
  }

  private parseBlockStatement(): BlockStatement {
    const block = new BlockStatement(this.tokenizer.curToken());

    this.tokenizer.nextToken();

    while (!this.tokenizer.curTokenIs('RBrace') && !this.tokenizer.curTokenIs('EOF')) {
      const stmt = this.parseStatement();
      if (stmt !== null) {
        block.statements.push(stmt);
      }
      this.tokenizer.nextToken();
    }

    return block;
  }

  private parseExpressionStatement(): ASTStatement | null {
    const statementToken = this.tokenizer.curToken();

    const expression = this.parseExpression(LOWEST);

    if (this.tokenizer.peekTokenIs('Semicolon')) {
      this.tokenizer.nextToken();
    }

    return new ExpressionStatement(statementToken, expression);
  }

  private parseExpression(precendence: ParserPrecedence): ASTExpression | null {
    const prefix = this.prefixParseFns.get(this.tokenizer.curToken().type);
    if (!prefix) {
      this.noPrefixParseFnError(this.tokenizer.curToken().type);
      return null;
    }
    let leftExpr = prefix();

    while (
      !this.tokenizer.peekTokenIs('Semicolon') &&
      precendence < this.peekPrecedence()
    ) {
      const infix = this.infixParseFns.get(this.tokenizer.peekToken().type);
      if (!infix) {
        return leftExpr;
      }
      this.tokenizer.nextToken();
      if (leftExpr) {
        leftExpr = infix(leftExpr);
      }
    }

    return leftExpr;
  }

  private parsePrefixExpression(): ASTExpression {
    const exprToken = this.tokenizer.curToken();
    let literal: string | number = exprToken.literal.toString();
    this.tokenizer.nextToken();
    const right = this.parseExpression(PREFIX);
    return new PrefixExpression(exprToken, literal.toString(), right);
  }

  private parseInfixExpression(left: ASTExpression): ASTExpression {
    const exprToken = this.tokenizer.curToken();
    const op = this.tokenizer.curToken().literal;
    const precedence = this.curPrecedence();
    this.tokenizer.nextToken();
    const right = this.parseExpression(precedence);
    if (!right) {
      const message = `Parser: Fatal: unable to parse right hand side of infix operator ${op}`;
      this.errors.push(message);
      throw new Error(this.errors.join('\n'));
    }
    return new InfixExpression(exprToken, left, op, right);
  }

  private parseGroupedExpression(): ASTExpression | null {
    this.tokenizer.nextToken();
    const expr = this.parseExpression(LOWEST);
    if (!this.expectPeek('RParen')) {
      return null;
    }
    return expr;
  }

  // @TODO: Keep a map of identifiers so I can map the type here
  private parseIdentifier(): ASTExpression {
    return new Identifier(this.tokenizer.curToken());
  }

  private parseIfStatement(): ASTStatement | null {
    const exprToken = this.tokenizer.curToken();

    if (!this.expectPeek('LParen')) {
      return null;
    }

    this.tokenizer.nextToken();
    const condition = this.parseExpression(LOWEST);

    if (!this.expectPeek('RParen')) {
      return null;
    }

    if (!this.expectPeek('LBrace')) {
      return null;
    }

    if (!condition) {
      return null;
    }

    const consequence = this.parseBlockStatement();
    const expression = new IfStatement(exprToken, condition, consequence);
    if (this.tokenizer.peekTokenIs('Else')) {
      this.tokenizer.nextToken();

      if (!this.expectPeek('LBrace')) {
        return null;
      }

      expression.elseBlock = this.parseBlockStatement();
    }

    return expression;
  }

  private parseCallExpression(func: ASTExpression): ASTExpression {
    return new CallExpression(this.tokenizer.curToken(), func, this.parseCallArguments());
  }

  private parseCallArguments(): ASTExpression[] {
    const args: ASTExpression[] = [];

    if (this.tokenizer.peekTokenIs('RParen')) {
      this.tokenizer.nextToken();
      return args;
    }

    this.tokenizer.nextToken();
    const expr = this.parseExpression(LOWEST);
    if (expr) args.push(expr);

    while (this.tokenizer.peekTokenIs('Comma')) {
      this.tokenizer.nextToken();
      this.tokenizer.nextToken();

      const expr = this.parseExpression(LOWEST);
      if (expr) args.push(expr);
    }

    if (!this.expectPeek('RParen')) {
      return [];
    }

    return args;
  }

  private parseFloatLiteral(): ASTExpression | null {
    const literalToken = this.tokenizer.curToken();
    if (literalToken.type !== 'FloatLiteral') {
      this.tokenizer.nextToken();
      return null;
    }
    const value = literalToken.literal;
    if (isNaN(value)) {
      const message = `Parser: Could not parse ${this.tokenizer.curToken().literal} as a number`;
      this.errors.push(message);
      return null;
    }
    return new FloatLiteralExpression(literalToken, value);
  }

  private parseBooleanLiteral(): ASTExpression {
    return new BooleanLiteralExpression(this.tokenizer.curToken(), this.tokenizer.curTokenIs('True'));
  }

  private parseFunctionLiteral(): ASTExpression | null {
    const literalToken = this.tokenizer.curToken();

    if (!this.expectPeek('LParen')) {
      return null;
    }

    const parameters = this.parseFunctionParameters();

    let returnType: string = '';
    if (this.tokenizer.peekTokenIs('Colon')) {
      this.tokenizer.nextToken();
      const t = this.parseTypeNode();
      if (!t) {
        return null;
      }
      returnType = t;
    }

    if (!this.expectPeek('LBrace')) {
      return null;
    }

    const body = this.parseBlockStatement();

    return new FunctionLiteralExpression(literalToken, parameters, body, returnType);
  }

  private parseFunctionParameters(): FunctionParam[] {
    const params: FunctionParam[] = [];

    if (this.tokenizer.peekTokenIs('RParen')) {
      this.tokenizer.nextToken();
      return params;
    }

    this.tokenizer.nextToken();
    const first = this.parseTypedParameter();
    if (first) {
      params.push(first);
    }

    while (this.tokenizer.peekTokenIs('Comma')) {
      this.tokenizer.nextToken();
      this.tokenizer.nextToken();
      const p = this.parseTypedParameter();
      if (p) params.push(p);
    }

    if (!this.expectPeek('RParen')) {
      return [];
    }

    return params;
  }

  private parseTypedParameter(): FunctionParam | null {
    if (this.tokenizer.curToken().type !== 'Identifier') {
      this.peekError('Identifier');
      return null;
    }
    const identToken = this.tokenizer.curToken();
    if (!this.expectPeek('Colon')) {
      return null;
    }
    const typeNode = this.parseTypeNode();
    if (!typeNode) {
      return null;
    }
    const ident = new Identifier(identToken, typeNode)
    ident.typeAnnotation = typeNode;
    return {
      identifier: ident,
      type: typeNode,
    };
  }

  private registerPrefix(type: Token['type'], fn: PrefixParseFn) {
    this.prefixParseFns.set(type, fn);
  }

  private registerInfix(type: Token['type'], fn: InfixParseFn) {
    this.infixParseFns.set(type, fn);
  }

  private registerPostfix(type: Token['type'], fn: PostfixParseFn) {
    this.postfixParseFns.set(type, fn);
  }

  private expectPeek(type: Token['type']): boolean {
    if (this.tokenizer.peekTokenIs(type)) {
      this.tokenizer.nextToken();
      return true;
    }
    this.peekError(type);
    return false;
  }

  private curPrecedence(): ParserPrecedence {
    const precedence = this.precendences[this.tokenizer.curToken().type];
    return precedence ?? LOWEST;
  }

  private peekPrecedence() {
    const precedence = this.precendences[this.tokenizer.peekToken().type];
    return precedence ?? LOWEST;
  }

  private parseTypeNode(): string | null {
    if (!this.expectPeek('Identifier')) {
      this.errors.push(`Parser: expected type.`);
      return null;
    }
    const curToken = this.tokenizer.curToken() as IdentToken;
    return curToken.literal;
  }

  // Errors
  private peekError(type: Token['type']) {
    const peekType = this.tokenizer.peekToken().type;
    const message = `Parser: Expected next token to be ${type}, got ${peekType}`;
    this.errors.push(message);
  }

  private noPrefixParseFnError(type: Token['type']) {
    const message = `Parser: No prefix parse function found for ${type}.`;
    this.errors.push(message);
  }

}
