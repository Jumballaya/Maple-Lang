import { sizeofType } from "../compiler/emitters/emit.types";
import { StructMember } from "../compiler/emitters/emitter.types";
import { FloatToken, IdentToken, Token, VoidToken } from "../lexer/token.types";
import { Tokenizer } from "../lexer/Tokenizer";
import { ASTProgram } from "./ast/ASTProgram";
import { ArrayLiteralExpression } from "./ast/expressions/ArrayLiteralExpression";
import { BooleanLiteralExpression } from "./ast/expressions/BooleanLiteralExpression";
import { CallExpression } from "./ast/expressions/CallExpression";
import { FloatLiteralExpression } from "./ast/expressions/FloatLiteralExpression";
import {
  FunctionLiteralExpression,
  FunctionParam,
} from "./ast/expressions/FunctionLiteralExpression";
import { Identifier } from "./ast/expressions/Identifier";
import { InfixExpression } from "./ast/expressions/InfixExpression";
import { IntegerLiteralExpression } from "./ast/expressions/IntegerLiteral";
import { PrefixExpression } from "./ast/expressions/PrefixExpression";
import { BlockStatement } from "./ast/statements/BlockStatement";
import { ExpressionStatement } from "./ast/statements/ExpressionStatement";
import { FunctionStatement } from "./ast/statements/FunctionStatement";
import { IfStatement } from "./ast/statements/IfStatement";
import { ImportStatement } from "./ast/statements/ImportStatement";
import { LetStatement } from "./ast/statements/LetStatement";
import { ReturnStatement } from "./ast/statements/ReturnStatement";
import { StructStatement } from "./ast/statements/StructStatement";
import {
  ASTExpression,
  ASTStatement,
  InfixParseFn,
  PostfixParseFn,
  PrefixParseFn,
} from "./ast/types/ast.type";
import { BUILTIN_TYPES } from "./ast/types/builtin_types";
import {
  CALL,
  EQUALS,
  LESSGREATER,
  LOWEST,
  ParserPrecedence,
  PREFIX,
  PRODUCT,
  SUM,
} from "./ast/types/parser.type";

export class Parser {
  private tokenizer: Tokenizer;
  public errors: Array<{ message: string; token: Token }> = [];

  private prefixParseFns: Map<Token["type"], PrefixParseFn> = new Map();
  private infixParseFns: Map<Token["type"], InfixParseFn> = new Map();
  private postfixParseFns: Map<Token["type"], PostfixParseFn> = new Map();

  private identifierTypes: Map<string, string> = new Map();

  private locals: string[] = []; // all of the variables local to the current scope

  private precendences: Partial<Record<Token["type"], ParserPrecedence>> = {
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
    this.registerPrefix("Identifier", this.parseIdentifier.bind(this));
    this.registerPrefix("FloatLiteral", this.parseFloatLiteral.bind(this));
    this.registerPrefix("IntegerLiteral", this.parseIntegerLiteral.bind(this));

    this.registerPrefix("Bang", this.parsePrefixExpression.bind(this));
    this.registerPrefix("Minus", this.parsePrefixExpression.bind(this));
    this.registerPrefix("True", this.parseBooleanLiteral.bind(this));
    this.registerPrefix("False", this.parseBooleanLiteral.bind(this));
    this.registerPrefix("LParen", this.parseGroupedExpression.bind(this));
    this.registerPrefix("Func", this.parseFunctionLiteral.bind(this));

    // Infix
    this.registerInfix("Plus", this.parseInfixExpression.bind(this));
    this.registerInfix("Minus", this.parseInfixExpression.bind(this));
    this.registerInfix("Slash", this.parseInfixExpression.bind(this));
    this.registerInfix("Star", this.parseInfixExpression.bind(this));
    this.registerInfix("Equals", this.parseInfixExpression.bind(this));
    this.registerInfix("NotEquals", this.parseInfixExpression.bind(this));
    this.registerInfix("LessThan", this.parseInfixExpression.bind(this));
    this.registerInfix("GreaterThan", this.parseInfixExpression.bind(this));
    this.registerInfix("LParen", this.parseCallExpression.bind(this));
  }

  public parse(name: string): ASTProgram {
    const program = new ASTProgram("expression", name);

    while (this.tokenizer.curToken().type !== "EOF") {
      const statement = this.parseStatement(false, true);
      if (statement !== null) {
        program.statements.push(statement);
      }
      this.tokenizer.nextToken();
    }

    return program;
  }

  private parseStatement(
    exported = false,
    topLevel = false
  ): ASTStatement | null {
    const token = this.tokenizer.curToken();
    switch (token.type) {
      case "Identifier": {
        if (!topLevel) {
          this.errors.push({
            message: "Parser: Imports/Exports must be top-level only",
            token,
          });
          return null;
        }
        if (token.literal === "export") {
          this.tokenizer.nextToken();
          return this.parseStatement(true, true);
        }
        if (token.literal === "import") {
          return this.parseImportStatement();
        }
        this.errors.push({
          message: "Parser: No idenitifier expression at the top level",
          token,
        });
        return null;
      }

      case "Func": {
        return this.parseFunctionStatement(exported);
      }

      case "Let": {
        return this.parseLetStatement(exported);
      }

      case "Struct": {
        return this.parseStructStatement(exported);
      }

      case "Return": {
        return this.parseReturnStatement();
      }

      case "If": {
        return this.parseIfStatement();
      }

      default: {
        return this.parseExpressionStatement();
      }
    }
  }

  private parseFunctionStatement(exported = false): ASTStatement | null {
    const statementToken = this.tokenizer.curToken();
    this.tokenizer.nextToken(); // skip past 'fn' token

    // Get identifier
    if (!this.tokenizer.curTokenIs("Identifier")) {
      return null;
    }
    const identToken = this.tokenizer.curToken();
    const ident = identToken.literal.toString();

    // Get the function expression: (): {}
    const expr =
      this.parseFunctionLiteral() as FunctionLiteralExpression | null;

    if (!expr) {
      return null;
    }

    this.identifierTypes.set(ident, expr.returnType);

    return new FunctionStatement(statementToken, expr, ident, exported);
  }

  private parseImportStatement(): ASTStatement | null {
    const tok = this.tokenizer.curToken();
    this.tokenizer.nextToken(); // consume the 'import' token

    if (!this.tokenizer.curTokenIs("Identifier")) {
      this.errors.push({
        message: "Parser: no identifier found for import statement",
        token: this.tokenizer.curToken(),
      });
      return null;
    }
    const imported: string[] = [];
    const identToken = this.tokenizer.curToken();
    const ident = identToken.literal.toString();
    imported.push(ident);

    while (this.tokenizer.peekTokenIs("Comma")) {
      this.tokenizer.nextToken(); // get the to comma
      this.tokenizer.nextToken(); // consume the comma
      const identToken = this.tokenizer.curToken();
      const ident = identToken.literal.toString();
      imported.push(ident);
    }

    for (const imp of imported) {
      this.identifierTypes.set(imp, "i32"); // set dummy value for now
    }

    if (!this.tokenizer.peekTokenIs("Identifier")) {
      this.errors.push({
        message: "Parser: keyword 'from' missing in import statement",
        token: this.tokenizer.curToken(),
      });
      return null;
    }

    this.tokenizer.nextToken(); // consume last comma or first import

    const importToken = this.tokenizer.curToken() as IdentToken;
    if (importToken.literal !== "from") {
      this.errors.push({
        message: `Parser: keyword 'from' missing in import statement, got: ${importToken.literal}`,
        token: this.tokenizer.curToken(),
      });
      return null;
    }

    this.tokenizer.nextToken(); // consume the 'from' identifier

    const pathToken = this.tokenizer.curToken();
    if (pathToken.type !== "StringLiteral") {
      this.errors.push({
        message: `Parser: import path must be a string`,
        token: this.tokenizer.curToken(),
      });
      return null;
    }

    const importPath = new TextDecoder().decode(pathToken.literal);
    return new ImportStatement(tok, imported, importPath);
  }

  private parseStructStatement(exported = false): ASTStatement | null {
    const statementToken = this.tokenizer.nextToken(); // consume 'struct' token
    if (!this.tokenizer.curTokenIs("Identifier")) {
      return null;
    }
    const identToken = this.tokenizer.curToken();
    const name = identToken.literal.toString();

    if (!this.expectPeek("LBrace")) {
      return null;
    }

    const members: Record<string, StructMember> = {};
    let size = 0;

    while (!this.tokenizer.peekTokenIs("RBrace")) {
      if (!this.expectPeek("Identifier")) {
        return null;
      }
      const firstIdent = this.tokenizer.curToken();
      const firstName = firstIdent.literal.toString();
      if (!this.expectPeek("Colon")) {
        return null;
      }
      this.tokenizer.nextToken();
      const firstType = this.parseTokenType(this.tokenizer.curToken());
      const sz = sizeofType(firstType);
      members[firstName] = {
        name: firstName,
        offset: size,
        size: sz,
        type: firstType,
      };
      size += sz;

      if (!this.expectPeek("Comma")) {
        return null;
      }
    }

    this.tokenizer.nextToken();

    return new StructStatement(statementToken, name, members, size, exported);
  }

  private parseTokenType(token: Token): string {
    switch (token.type) {
      case "Identifier": {
        return "i32"; // struct pointer
      }
      case "StringLiteral": {
        return "i32"; // string pointer
      }
      case "Boolean": {
        return "i32";
      }
      case "FloatLiteral": {
        return "f32";
      }
      case "i32":
      case "i16":
      case "i8":
      case "u32":
      case "u16":
      case "u8": {
        return "i32";
      }
      case "f32": {
        return "f32";
      }
    }
    return "";
  }

  private parseLetStatement(exported = false): ASTStatement | null {
    const statementToken = this.tokenizer.curToken();
    if (!this.expectPeek("Identifier")) {
      return null;
    }
    const identToken = this.tokenizer.curToken();

    let typeAnn = "";
    if (this.tokenizer.peekTokenIs("Colon")) {
      this.tokenizer.nextToken();
      this.tokenizer.nextToken(); // consume colon
      const t = this.parseTyping();
      if (!t) return null;
      typeAnn = t;
    }
    const identifier = new Identifier(identToken, typeAnn);
    this.identifierTypes.set(identToken.literal.toString(), typeAnn);

    if (!this.expectPeek("Assign")) {
      return null;
    }

    this.tokenizer.nextToken();

    // this is an array literal, it needs the type up front
    const isArray = this.tokenizer.curTokenIs("LBracket");
    const value = isArray
      ? this.parseArrayLiteral(typeAnn)
      : this.parseExpression(LOWEST);

    if (this.tokenizer.peekTokenIs("Semicolon")) {
      this.tokenizer.nextToken();
    }

    // @TODO: keep a map of ident types to use here
    const letStmt = new LetStatement(
      statementToken,
      identifier,
      "",
      value,
      exported
    );
    letStmt.typeAnnotation = typeAnn;
    return letStmt;
  }

  private parseReturnStatement(): ASTStatement | null {
    const statementToken = this.tokenizer.curToken();
    this.tokenizer.nextToken();

    const returnValue = this.parseExpression(LOWEST);

    if (this.tokenizer.peekTokenIs("Semicolon")) {
      this.tokenizer.nextToken();
    }

    return new ReturnStatement(statementToken, returnValue);
  }

  private parseBlockStatement(): BlockStatement {
    const block = new BlockStatement(this.tokenizer.curToken());

    this.tokenizer.nextToken();

    while (
      !this.tokenizer.curTokenIs("RBrace") &&
      !this.tokenizer.curTokenIs("EOF")
    ) {
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

    if (this.tokenizer.peekTokenIs("Semicolon")) {
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
      !this.tokenizer.peekTokenIs("Semicolon") &&
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
    const op = this.tokenizer.curToken().literal.toString();
    const precedence = this.curPrecedence();
    this.tokenizer.nextToken();
    const right = this.parseExpression(precedence);
    if (!right) {
      const message = `Parser: Fatal: unable to parse right hand side of infix operator ${op}`;
      this.errors.push({ message, token: exprToken });
      throw new Error(this.errors.join("\n"));
    }
    return new InfixExpression(exprToken, left, op, right);
  }

  private parseGroupedExpression(): ASTExpression | null {
    this.tokenizer.nextToken();
    const expr = this.parseExpression(LOWEST);
    if (!this.expectPeek("RParen")) {
      return null;
    }
    return expr;
  }

  // @TODO: Keep a map of identifiers so I can map the type here
  private parseIdentifier(): ASTExpression {
    const tok = this.tokenizer.curToken();
    const literal = tok.literal;
    const type = this.getType(literal.toString());

    return new Identifier(tok, type);
  }

  private parseIfStatement(): ASTStatement | null {
    const exprToken = this.tokenizer.curToken();

    if (!this.expectPeek("LParen")) {
      return null;
    }

    this.tokenizer.nextToken();
    const condition = this.parseExpression(LOWEST);

    if (!this.expectPeek("RParen")) {
      return null;
    }

    if (!this.expectPeek("LBrace")) {
      return null;
    }

    if (!condition) {
      return null;
    }

    const consequence = this.parseBlockStatement();
    const expression = new IfStatement(exprToken, condition, consequence);
    if (this.tokenizer.peekTokenIs("Else")) {
      this.tokenizer.nextToken();

      if (!this.expectPeek("LBrace")) {
        return null;
      }

      expression.elseBlock = this.parseBlockStatement();
    }

    return expression;
  }

  private parseCallExpression(func: ASTExpression): ASTExpression {
    return new CallExpression(
      this.tokenizer.curToken(),
      func.tokenLiteral(),
      this.parseCallArguments()
    );
  }

  private parseCallArguments(): ASTExpression[] {
    const args: ASTExpression[] = [];

    if (this.tokenizer.peekTokenIs("RParen")) {
      this.tokenizer.nextToken();
      return args;
    }

    this.tokenizer.nextToken();
    const expr = this.parseExpression(LOWEST);
    if (expr) args.push(expr);

    while (this.tokenizer.peekTokenIs("Comma")) {
      this.tokenizer.nextToken();
      this.tokenizer.nextToken();

      const expr = this.parseExpression(LOWEST);
      if (expr) args.push(expr);
    }

    if (!this.expectPeek("RParen")) {
      return [];
    }

    return args;
  }

  private parseFloatLiteral(): ASTExpression | null {
    const literalToken = this.tokenizer.curToken();
    if (literalToken.type !== "FloatLiteral") {
      this.tokenizer.nextToken();
      return null;
    }
    const value = literalToken.literal;
    if (isNaN(value)) {
      const message = `Parser: Could not parse ${
        this.tokenizer.curToken().literal
      } as a number`;
      this.errors.push({ message, token: this.tokenizer.curToken() });
      return null;
    }
    return new FloatLiteralExpression(literalToken, value);
  }

  private parseIntegerLiteral(): ASTExpression | null {
    const literalToken = this.tokenizer.curToken();
    if (literalToken.type !== "IntegerLiteral") {
      this.tokenizer.nextToken();
      return null;
    }
    const value = literalToken.literal;
    if (isNaN(value)) {
      const message = `Parser: Could not parse ${
        this.tokenizer.curToken().literal
      } as a number`;
      this.errors.push({ message, token: this.tokenizer.curToken() });
      return null;
    }
    return new IntegerLiteralExpression(literalToken, value);
  }

  private parseBooleanLiteral(): ASTExpression {
    return new BooleanLiteralExpression(
      this.tokenizer.curToken(),
      this.tokenizer.curTokenIs("True")
    );
  }

  private parseArrayLiteral(type: string): ASTExpression | null {
    const literalToken = this.tokenizer.curToken();

    if (!this.tokenizer.curTokenIs("LBracket")) {
      return null;
    }
    this.tokenizer.nextToken(); // consume LBracket
    const value = [];

    // initial values
    if (!this.tokenizer.curTokenIs("RBracket")) {
      const v = this.parseArrayLiteralMember();
      if (v !== null) {
        value.push(v);
      }
    }

    // more values
    while (this.tokenizer.curTokenIs("Comma")) {
      this.tokenizer.nextToken(); // consume Comma
      const v = this.parseArrayLiteralMember();
      if (v !== null) {
        value.push(v);
      }
    }

    if (!this.tokenizer.curTokenIs("RBracket")) {
      return null;
    }

    this.tokenizer.nextToken(); // consume RBracket

    return new ArrayLiteralExpression(literalToken, type, value);
  }

  private parseArrayLiteralMember(): number | null {
    const p = this.parseExpression(LOWEST);
    if (!p) {
      this.errors.push({
        message: "Parser: missing expression in array literal",
        token: this.tokenizer.curToken(),
      });
      return null;
    }
    const isFloat = p instanceof FloatLiteralExpression;
    const isInt = p instanceof IntegerLiteralExpression;
    const isBool = p instanceof BooleanLiteralExpression;
    if (!(isFloat || isInt || isBool)) {
      this.errors.push({
        message:
          "Parser: only float, integer and bool literals in an array literal are supported",
        token: this.tokenizer.curToken(),
      });
      return null;
    }
    this.tokenizer.nextToken();
    return typeof p.value === "number" ? p.value : p.value ? 1 : 0;
  }

  private parseFunctionLiteral(): ASTExpression | null {
    const literalToken = this.tokenizer.curToken();

    if (!this.expectPeek("LParen")) {
      return null;
    }

    const parameters = this.parseFunctionParameters();

    if (!this.expectPeek("Colon")) {
      return null;
    }
    this.tokenizer.nextToken(); // consume the colon

    const t = this.parseTyping();
    if (!t) {
      return null;
    }

    if (!this.expectPeek("LBrace")) {
      return null;
    }

    const body = this.parseBlockStatement();

    this.deleteLocals(); // deletes all function locals
    return new FunctionLiteralExpression(literalToken, parameters, body, t);
  }

  private parseFunctionParameters(): FunctionParam[] {
    const params: FunctionParam[] = [];

    if (this.tokenizer.peekTokenIs("RParen")) {
      this.tokenizer.nextToken();
      return params;
    }

    this.tokenizer.nextToken();
    const first = this.parseTypedParameter();
    if (first) {
      params.push(first);
    }

    while (this.tokenizer.peekTokenIs("Comma")) {
      this.tokenizer.nextToken();
      this.tokenizer.nextToken();
      const p = this.parseTypedParameter();
      if (p) params.push(p);
    }

    if (!this.expectPeek("RParen")) {
      return [];
    }

    return params;
  }

  private parseTypedParameter(): FunctionParam | null {
    if (this.tokenizer.curToken().type !== "Identifier") {
      this.peekError("Identifier");
      return null;
    }
    const identToken = this.tokenizer.curToken();
    if (!this.expectPeek("Colon")) {
      return null;
    }
    this.tokenizer.nextToken(); // consume the colon
    const type = this.parseTyping();
    if (!type) {
      return null;
    }
    const ident = new Identifier(identToken, type);
    const varName = identToken.literal.toString();
    this.identifierTypes.set(varName, type);
    this.locals.push(varName);
    return {
      identifier: ident,
      type,
    };
  }

  private registerPrefix(type: Token["type"], fn: PrefixParseFn) {
    this.prefixParseFns.set(type, fn);
  }

  private registerInfix(type: Token["type"], fn: InfixParseFn) {
    this.infixParseFns.set(type, fn);
  }

  private registerPostfix(type: Token["type"], fn: PostfixParseFn) {
    this.postfixParseFns.set(type, fn);
  }

  private expectPeek(type: Token["type"]): boolean {
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

  private parseTyping(): string | null {
    const curToken = this.tokenizer.curToken();
    let type = curToken.literal.toString();

    const isIdent = this.tokenizer.curTokenIs("Identifier");
    const isBuiltin = BUILTIN_TYPES.includes(type as any);

    if (!isIdent && !isBuiltin) {
      this.errors.push({
        message: `Parser: Expected type, none found`,
        token: this.tokenizer.curToken(),
      });
      return null;
    }

    if (this.tokenizer.peekTokenIs("LBracket")) {
      this.tokenizer.nextToken();
      if (!this.expectPeek("RBracket")) {
        this.errors.push({
          message: `Parser: array types must include the ending bracket`,
          token: this.tokenizer.curToken(),
        });
        return null;
      }
      type += "[]";
    }

    return type;
  }

  private getType(ident: string): string {
    const type = this.identifierTypes.get(ident);
    if (!type) {
      this.errors.push({
        message: `Parser: Identifier not found: ${ident}`,
        token: this.tokenizer.curToken(),
      });
      return "";
    }
    return type;
  }

  // Errors
  private peekError(type: Token["type"]) {
    const peekType = this.tokenizer.peekToken().type;
    const message = `Parser: Expected next token to be ${type}, got ${peekType}`;
    this.errors.push({ message, token: this.tokenizer.peekToken() });
  }

  private noPrefixParseFnError(type: Token["type"]) {
    const message = `Parser: No prefix parse function found for ${type}.`;
    this.errors.push({ message, token: this.tokenizer.curToken() });
  }

  // Function State
  private deleteLocals() {
    for (const l of this.locals) {
      this.identifierTypes.delete(l);
    }
    this.locals.length = 0;
  }
}
