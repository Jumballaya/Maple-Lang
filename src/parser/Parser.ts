import { Token } from "../lexer/token.types";
import { Tokenizer } from "../lexer/Tokenizer";
import { ASTProgram } from "./ast/ASTProgram";
import { Identifier } from "./ast/expressions/Identifier";
import { BlockStatement } from "./ast/statements/BlockStatement";
import { LetStatement } from "./ast/statements/LetStatement";
import { ReturnStatement } from "./ast/statements/ReturnStatement";
import { ASTStatement, InfixParseFn, PostfixParseFn, PrefixParseFn } from "./ast/types/ast.type";
import { CALL, EQUALS, LESSGREATER, LOWEST, ParserPrecedence, PRODUCT, SUM } from "./ast/types/parser.type";

export class Parser {
  private tokenizer: Tokenizer;
  private errors: string[] = [];

  private nextIdentSymbol = 0;
  private nextStructSymbol = 0;

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
    this.registerPrefix('If', this.parseIfExpression.bind(this));
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
      case 'Let':
        return this.parseLetStatement();

      case 'Return':
        return this.parseReturnStatement();

      default:
        return this.parseExpressionStatement();
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
    const identifier = new Identifier(identToken, typeAnn, this.genIdentSymbol());

    if (!this.expectPeek('Assign')) {
      return null;
    }

    this.tokenizer.nextToken();

    const value = this.parseExpression(LOWEST);

    if (this.tokenizer.peekTokenIs('Semicolon')) {
      this.tokenizer.nextToken();
    }

    const letStmt = new LetStatement(statementToken, identifier, value);
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

  private parseExpressionStatement(): AstStatement | null {
    const statementToken = this.curToken;

    const expression = this.parseExpression(LOWEST);

    if (this.peekTokenIs('semicolon')) {
      this.nextToken();
    }

    return new ExpressionStatement(statementToken, expression);
  }

  private parseExpression(precendence: ParserPrecedence): AstExpression | null {
    const prefix = this.prefixParseFns.get(this.curToken.type);
    if (!prefix) {
      this.noPrefixParseFnError(this.curToken.type);
      return null;
    }
    let leftExpr = prefix();

    while (
      !this.peekTokenIs('semicolon') &&
      precendence < this.peekPrecedence()
    ) {
      const infix = this.infixParseFns.get(this.peekToken.type);
      if (!infix) {
        return leftExpr;
      }
      this.nextToken();
      if (leftExpr) {
        leftExpr = infix(leftExpr);
      }
    }

    return leftExpr;
  }

  private parsePrefixExpression(): AstExpression {
    const exprToken = this.curToken;
    this.nextToken();
    const right = this.parseExpression(PREFIX);
    return new PrefixExpression(exprToken, exprToken.literal, right);
  }

  private parseInfixExpression(left: AstExpression): AstExpression {
    const exprToken = this.curToken;
    const op = this.curToken.literal;
    const precedence = this.curPrecedence();
    this.nextToken();
    const right = this.parseExpression(precedence);
    if (!right) {
      const message = `Parser: Fatal: unable to parse right hand side of infix operator ${op}`;
      this.errors.push(message);
      throw new Error(this.errors.join('\n'));
    }
    return new InfixExpression(exprToken, left, op, right);
  }

  private parseGroupedExpression(): AstExpression | null {
    this.nextToken();
    const expr = this.parseExpression(LOWEST);
    if (!this.expectPeek('rparen')) {
      return null;
    }
    return expr;
  }

  private parseIdentifier(): AstExpression {
    return new Identifier(this.curToken);
  }

  private parseIfExpression(): AstExpression | null {
    const exprToken = this.curToken;

    if (!this.expectPeek('lparen')) {
      return null;
    }

    this.nextToken();
    const condition = this.parseExpression(LOWEST);

    if (!this.expectPeek('rparen')) {
      return null;
    }

    if (!this.expectPeek('lbrace')) {
      return null;
    }

    if (!condition) {
      return null;
    }

    const consequence = this.parseBlockStatement();
    const expression = new IfExpression(exprToken, condition, consequence);
    if (this.peekTokenIs('else')) {
      this.nextToken();

      if (!this.expectPeek('lbrace')) {
        return null;
      }

      expression.alternative = this.parseBlockStatement();
    }

    return expression;
  }

  private parseCallExpression(func: AstExpression): AstExpression {
    return new CallExpression(this.curToken, func, this.parseCallArguments());
  }

  private parseCallArguments(): AstExpression[] {
    const args: AstExpression[] = [];

    if (this.peekTokenIs('rparen')) {
      this.nextToken();
      return args;
    }

    this.nextToken();
    const expr = this.parseExpression(LOWEST);
    if (expr) args.push(expr);

    while (this.peekTokenIs('comma')) {
      this.nextToken();
      this.nextToken();

      const expr = this.parseExpression(LOWEST);
      if (expr) args.push(expr);
    }

    if (!this.expectPeek('rparen')) {
      return [];
    }

    return args;
  }

  private parseFloatLiteral(): AstExpression | null {
    const literalToken = this.curToken;
    const value = parseFloat(this.curToken.literal);
    if (isNaN(value)) {
      const message = `Parser: Could not parse ${this.curToken.literal} as a number`;
      this.errors.push(message);
      return null;
    }
    return new FloatLiteral(literalToken, value);
  }

  private parseBooleanLiteral(): AstExpression {
    return new BooleanLiteral(this.curToken, this.curTokenIs('true'));
  }

  private parseFunctionLiteral(): AstExpression | null {
    const literalToken = this.curToken;

    if (!this.expectPeek('lparen')) {
      return null;
    }

    const parameters = this.parseFunctionParameters();

    let returnType: TypeNode | undefined;
    if (this.peekTokenIs('colon')) {
      this.nextToken();
      const t = this.parseTypeNode();
      if (!t) {
        return null;
      }
      returnType = t;
    }

    if (!this.expectPeek('lbrace')) {
      return null;
    }

    const body = this.parseBlockStatement();

    const fn = new FunctionLiteral(literalToken, parameters, body);
    fn.returnType = returnType;
    return fn;
  }

  private parseFunctionParameters(): Parameter[] {
    const params: Parameter[] = [];

    if (this.peekTokenIs('rparen')) {
      this.nextToken();
      return params;
    }

    this.nextToken();
    const first = this.parseTypedParameter();
    if (first) {
      params.push(first);
    }

    while (this.peekTokenIs('comma')) {
      this.nextToken();
      this.nextToken();
      const p = this.parseTypedParameter();
      if (p) params.push(p);
    }

    if (!this.expectPeek('rparen')) {
      return [];
    }

    return params;
  }

  private parseTypedParameter(): Parameter | null {
    if (this.curToken.type !== 'ident') {
      this.peekError('ident');
      return null;
    }
    const ident = new Identifier(this.curToken);
    if (!this.expectPeek('colon')) {
      return null;
    }
    const typeNode = this.parseTypeNode();
    if (!typeNode) {
      return null;
    }
    ident.typeAnnotation = typeNode;
    return {
      ident,
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

  private genIdentSymbol(): number {
    return this.nextIdentSymbol++;
  }
}
