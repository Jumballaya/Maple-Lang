import {
  canonicalFnType,
  isFnType,
  isUnsignedMapleInteger,
  sizeofType,
  valueTypeToWasm,
} from "../compiler/emitters/emit.types";
import { MapleError } from "../compiler/errors";
import { getIntrinsic } from "../compiler/intrinsics";
import { Tokenizer } from "../lexer/Tokenizer";
import type { IdentToken, Token } from "../lexer/token.types";
import { alignofType, alignTo, type StructMember } from "../shared/types";
import { ASTProgram } from "./ast/ASTProgram";
import { ArrayLiteralExpression } from "./ast/expressions/ArrayLiteralExpression";
import { AssignmentExpression } from "./ast/expressions/AssignmentExpression";
import { BooleanLiteralExpression } from "./ast/expressions/BooleanLiteralExpression";
import { CallExpression } from "./ast/expressions/CallExpression";
import { CastExpression } from "./ast/expressions/CastExpression";
import { FloatLiteralExpression } from "./ast/expressions/FloatLiteralExpression";
import {
  FunctionLiteralExpression,
  type FunctionParam,
} from "./ast/expressions/FunctionLiteralExpression";
import { Identifier } from "./ast/expressions/Identifier";
import { IndexExpression } from "./ast/expressions/IndexExpression";
import { InfixExpression } from "./ast/expressions/InfixExpression";
import { IntegerLiteralExpression } from "./ast/expressions/IntegerLiteral";
import { MemberExpression } from "./ast/expressions/MemberExpression";
import { PostfixExpression } from "./ast/expressions/PostfixExpression";
import { PrefixExpression } from "./ast/expressions/PrefixExpression";
import { StringLiteralExpression } from "./ast/expressions/StringLiteral";
import { StructLiteralExpression } from "./ast/expressions/StructLiteralExpression";
import { BlockStatement } from "./ast/statements/BlockStatement";
import { BreakStatement } from "./ast/statements/BreakStatement";
import { ContinueStatement } from "./ast/statements/ContinueStatement";
import { ExpressionStatement } from "./ast/statements/ExpressionStatement";
import { ForStatement } from "./ast/statements/ForStatement";
import { FunctionStatement } from "./ast/statements/FunctionStatement";
import { IfStatement } from "./ast/statements/IfStatement";
import { ImportStatement } from "./ast/statements/ImportStatement";
import { LetStatement } from "./ast/statements/LetStatement";
import { ReturnStatement } from "./ast/statements/ReturnStatement";
import { StructStatement } from "./ast/statements/StructStatement";
import { SwitchStatement } from "./ast/statements/SwitchStatement";
import { TuplePattern, type TuplePatternName } from "./ast/statements/TuplePattern";
import { WhileStatement } from "./ast/statements/WhileStatement";
import type {
  ASTExpression,
  ASTStatement,
  InfixParseFn,
  PostfixParseFn,
  PrefixParseFn,
} from "./ast/types/ast.type";
import { BUILTIN_TYPES } from "./ast/types/builtin_types";
import {
  ASSIGN,
  BIT_AND,
  BIT_OR,
  BIT_XOR,
  CALL,
  CAST,
  EQUALS,
  INDEX,
  LESSGREATER,
  LOGICAL_AND,
  LOGICAL_OR,
  LOWEST,
  type ParserPrecedence,
  PREFIX,
  PRODUCT,
  SHIFT,
  SUM,
} from "./ast/types/parser.type";

export class Parser {
  private tokenizer: Tokenizer;
  private file: string;
  public errors: MapleError[] = [];

  private prefixParseFns: Map<Token["type"], PrefixParseFn> = new Map();
  private infixParseFns: Map<Token["type"], InfixParseFn> = new Map();
  private postfixParseFns: Map<Token["type"], PostfixParseFn> = new Map();

  private identifierTypes: Map<string, string> = new Map();
  private structDefs: Map<string, Record<string, string>> = new Map();
  private functionReturnTypes: Map<string, string[]> = new Map();
  private functionParamTypes: Map<string, string[]> = new Map();

  private static readonly RESERVED_PREFIXES = [
    "__lambda_",
    "__indirect_",
    "__env",
    "__make_fnref",
    "__fn_table",
  ];

  private locals: string[] = []; // all of the variables local to the current scope

  private precendences: Partial<Record<Token["type"], ParserPrecedence>> = {
    LogicalOr: LOGICAL_OR,
    LogicalAnd: LOGICAL_AND,
    Pipe: BIT_OR,
    Caret: BIT_XOR,
    Ampersand: BIT_AND,
    Equals: EQUALS,
    NotEquals: EQUALS,
    LessThan: LESSGREATER,
    GreaterThan: LESSGREATER,
    LessThanEquals: LESSGREATER,
    GreaterThanEquals: LESSGREATER,
    LeftShift: SHIFT,
    RightShift: SHIFT,
    Plus: SUM,
    Minus: SUM,
    Slash: PRODUCT,
    Star: PRODUCT,
    Percent: PRODUCT,

    LParen: CALL,

    LBracket: INDEX,
    Period: INDEX,
    // Postfix `++` / `--` bind at the same level as `.` and `[]`, so
    // `p.x++` parses as `(p.x)++`, not `p.(x++)`.
    Increment: INDEX,
    Decrement: INDEX,

    As: CAST,

    Assign: ASSIGN,
    AddAssign: ASSIGN,
    MinusAssign: ASSIGN,
    MulAssign: ASSIGN,
    DivAssign: ASSIGN,
    ModuloAssign: ASSIGN,
    BitwiseOrAssign: ASSIGN,
    BitwiseAndAssign: ASSIGN,
    BitwiseXorAssign: ASSIGN,
    LeftShiftAssign: ASSIGN,
    RightShiftAssign: ASSIGN,
  };

  public getErrors(): MapleError[] {
    return this.errors;
  }

  /** Parser-level type hint for a name (e.g. `<unresolved-import>` for imports). */
  public getIdentifierTypeHint(name: string): string | undefined {
    return this.identifierTypes.get(name);
  }

  private isReservedName(name: string): boolean {
    return (
      Parser.RESERVED_PREFIXES.some((p) => name.startsWith(p)) || getIntrinsic(name) !== undefined
    );
  }

  private rejectIfReserved(name: string, kind: string, token: Token): void {
    if (this.isReservedName(name)) {
      this.pushError(
        `identifier '${name}' uses a reserved prefix or intrinsic name; ${kind} names cannot use compiler-reserved identifiers`,
        token,
      );
    }
  }

  constructor(source: string, file = "") {
    this.file = file;
    this.tokenizer = new Tokenizer(source);
    this.structDefs.set("string", { len: "i32", data: "i32" });

    // Prefix
    this.registerPrefix("Identifier", this.parseIdentifier.bind(this));
    this.registerPrefix("FloatLiteral", this.parseFloatLiteral.bind(this));
    this.registerPrefix("IntegerLiteral", this.parseIntegerLiteral.bind(this));
    this.registerPrefix("StringLiteral", this.parseStringLiteral.bind(this));

    this.registerPrefix("Tilde", this.parsePrefixExpression.bind(this));
    this.registerPrefix("Bang", this.parsePrefixExpression.bind(this));
    this.registerPrefix("Minus", this.parsePrefixExpression.bind(this));
    // Unary `+x` is a no-op; consume the `+` and return the operand.
    this.registerPrefix("Plus", this.parseUnaryPlus.bind(this));
    this.registerPrefix("True", this.parseBooleanLiteral.bind(this));
    this.registerPrefix("False", this.parseBooleanLiteral.bind(this));
    this.registerPrefix("LParen", this.parseGroupedExpression.bind(this));
    this.registerPrefix("Func", this.parseFunctionLiteral.bind(this));
    // Struct literal in expression position (`{x = 5, ...}`). The name is
    // resolved later from context (let-annotation, fn-param type, fn return
    // type, struct-field type). Parsing only — runtime support depends on
    // the surrounding context.
    this.registerPrefix("LBrace", this.parseAnonymousStructLiteral.bind(this));
    // Array literal in expression position (`[1, 2, 3]`).
    this.registerPrefix("LBracket", this.parseAnonymousArrayLiteral.bind(this));

    // Infix
    // @TODO: Move Assign logic to here
    // this.registerInfix("Assign", this.parseAssignExpression.bind(this));
    //
    this.registerInfix("Plus", this.parseInfixExpression.bind(this));
    this.registerInfix("Minus", this.parseInfixExpression.bind(this));
    this.registerInfix("Slash", this.parseInfixExpression.bind(this));
    this.registerInfix("Star", this.parseInfixExpression.bind(this));
    this.registerInfix("Percent", this.parseInfixExpression.bind(this));
    this.registerInfix("LogicalAnd", this.parseInfixExpression.bind(this));
    this.registerInfix("LogicalOr", this.parseInfixExpression.bind(this));
    this.registerInfix("Ampersand", this.parseInfixExpression.bind(this));
    this.registerInfix("Pipe", this.parseInfixExpression.bind(this));
    this.registerInfix("Caret", this.parseInfixExpression.bind(this));
    this.registerInfix("LeftShift", this.parseInfixExpression.bind(this));
    this.registerInfix("RightShift", this.parseInfixExpression.bind(this));
    this.registerInfix("Equals", this.parseInfixExpression.bind(this));
    this.registerInfix("NotEquals", this.parseInfixExpression.bind(this));
    this.registerInfix("LessThan", this.parseInfixExpression.bind(this));
    this.registerInfix("GreaterThan", this.parseInfixExpression.bind(this));
    this.registerInfix("LessThanEquals", this.parseInfixExpression.bind(this));
    this.registerInfix("GreaterThanEquals", this.parseInfixExpression.bind(this));
    this.registerInfix("LParen", this.parseCallExpression.bind(this));
    this.registerInfix("Assign", this.parseAssignmentExpression.bind(this));
    this.registerInfix("AddAssign", this.parseAssignmentExpression.bind(this));
    this.registerInfix("MinusAssign", this.parseAssignmentExpression.bind(this));
    this.registerInfix("MulAssign", this.parseAssignmentExpression.bind(this));
    this.registerInfix("DivAssign", this.parseAssignmentExpression.bind(this));
    this.registerInfix("ModuloAssign", this.parseAssignmentExpression.bind(this));
    this.registerInfix("BitwiseOrAssign", this.parseAssignmentExpression.bind(this));
    this.registerInfix("BitwiseAndAssign", this.parseAssignmentExpression.bind(this));
    this.registerInfix("BitwiseXorAssign", this.parseAssignmentExpression.bind(this));
    this.registerInfix("LeftShiftAssign", this.parseAssignmentExpression.bind(this));
    this.registerInfix("RightShiftAssign", this.parseAssignmentExpression.bind(this));
    this.registerInfix("Period", this.parseInfixExpression.bind(this));
    this.registerInfix("LBracket", this.parseIndexExpression.bind(this));
    this.registerInfix("As", this.parseCastExpression.bind(this));

    // Postfix
    this.registerPostfix("Increment", this.parsePostfixExpression.bind(this));
    this.registerPostfix("Decrement", this.parsePostfixExpression.bind(this));
  }

  public parse(name: string): ASTProgram {
    const program = new ASTProgram("expression", name);

    while (this.tokenizer.curToken().type !== "EOF") {
      const statement = this.parseStatement(false, true);
      if (statement !== null) {
        program.statements.push(statement);
        if (statement instanceof StructStatement) {
          const fields: Record<string, string> = {};
          for (const [fieldName, member] of Object.entries(statement.members)) {
            fields[fieldName] = member.type;
          }
          this.structDefs.set(statement.name, fields);
        }
      } else {
        this.synchronize();
      }
    }

    return program;
  }

  private parseStatement(exported = false, topLevel = false): ASTStatement | null {
    const token = this.tokenizer.curToken();
    switch (token.type) {
      case "Break": {
        const stmt = new BreakStatement(token);
        if (!this.expectPeek("Semicolon")) {
          this.pushError("Parser: semicolon expected after break statement", token);
          // Skip the offending token so the outer parse loop makes progress
          // (otherwise `break <ident>;` would re-enter this branch forever).
          this.tokenizer.nextToken();
          return null;
        }
        this.tokenizer.nextToken(); // consume the semicolon
        return stmt;
      }
      case "Continue": {
        const stmt = new ContinueStatement(token);
        if (!this.expectPeek("Semicolon")) {
          this.pushError("Parser: semicolon expected after continue statement", token);
          this.tokenizer.nextToken();
          return null;
        }
        this.tokenizer.nextToken(); // consume the semicolon
        return stmt;
      }
      case "Import": {
        if (!topLevel) {
          this.pushError("Parser: Imports must be top-level only", token);
          return null;
        }
        return this.parseImportStatement();
      }
      case "Export": {
        if (!topLevel) {
          this.pushError("Parser: Exports must be top-level only", token);
          return null;
        }
        this.tokenizer.nextToken();
        return this.parseStatement(true, true);
      }
      case "Func": {
        return this.parseFunctionStatement(exported);
      }

      case "Let": {
        return this.parseLetStatement(exported, true, topLevel);
      }
      case "Const": {
        return this.parseLetStatement(exported, false, topLevel);
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

      case "For": {
        return this.parseForStatement();
      }

      case "While": {
        return this.parseWhileStatement();
      }

      case "Switch": {
        return this.parseSwitchStatement();
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
    this.rejectIfReserved(ident, "function", identToken);
    let mangledName = ident;
    let receiverType: string | null = null;
    let receiverToken: Token | null = null;

    if (this.tokenizer.peekTokenIs("Period")) {
      this.tokenizer.nextToken(); // consume '.'
      if (!this.expectPeek("Identifier")) {
        return null;
      }
      const methodToken = this.tokenizer.curToken();
      const methodName = methodToken.literal.toString();
      mangledName = `${ident}_${methodName}`;
      receiverType = ident;

      if (!this.expectPeek("LParen")) {
        return null;
      }
      this.tokenizer.nextToken(); // consume '('
      if (!this.tokenizer.curTokenIs("Identifier")) {
        this.pushError(
          "Parser: method receiver binding requires an identifier",
          this.tokenizer.curToken(),
        );
        return null;
      }
      receiverToken = this.tokenizer.curToken();
      const receiverName = receiverToken.literal.toString();
      this.identifierTypes.set(receiverName, ident);
      this.locals.push(receiverName);
      if (!this.expectPeek("RParen")) {
        return null;
      }
    }

    // Get the function expression: (): {}
    const expr = this.parseFunctionLiteral() as FunctionLiteralExpression | null;

    if (!expr) {
      return null;
    }
    if (receiverType && receiverToken) {
      expr.params.unshift({
        identifier: new Identifier(receiverToken, receiverType),
        type: receiverType,
      });
    }

    if (!this.tokenizer.curTokenIs("RBrace")) {
      return null;
    }
    this.tokenizer.nextToken();

    this.functionReturnTypes.set(mangledName, expr.returnTypes);
    this.functionParamTypes.set(
      mangledName,
      expr.params.map((p) => p.type),
    );
    return new FunctionStatement(statementToken, expr, mangledName, exported, receiverType);
  }

  private parseImportStatement(): ASTStatement | null {
    const tok = this.tokenizer.curToken();
    this.tokenizer.nextToken(); // consume the 'import' token

    if (!this.tokenizer.curTokenIs("Identifier")) {
      this.pushError("Parser: no identifier found for import statement", this.tokenizer.curToken());
      return null;
    }
    const imported: string[] = [];
    const identToken = this.tokenizer.curToken();
    const ident = identToken.literal.toString();
    this.rejectIfReserved(ident, "import", identToken);
    imported.push(ident);

    while (this.tokenizer.peekTokenIs("Comma")) {
      this.tokenizer.nextToken(); // get the to comma
      this.tokenizer.nextToken(); // consume the comma
      const identToken = this.tokenizer.curToken();
      const ident = identToken.literal.toString();
      this.rejectIfReserved(ident, "import", identToken);
      imported.push(ident);
    }

    for (const imp of imported) {
      this.identifierTypes.set(imp, "<unresolved-import>");
    }

    if (!this.tokenizer.peekTokenIs("Identifier")) {
      this.pushError(
        "Parser: keyword 'from' missing in import statement",
        this.tokenizer.curToken(),
      );
      return null;
    }

    this.tokenizer.nextToken(); // consume last comma or first import

    const importToken = this.tokenizer.curToken() as IdentToken;
    if (importToken.literal !== "from") {
      this.pushError(
        `Parser: keyword 'from' missing in import statement, got: ${importToken.literal}`,
        this.tokenizer.curToken(),
      );
      return null;
    }

    this.tokenizer.nextToken(); // consume the 'from' identifier

    const pathToken = this.tokenizer.curToken();
    if (pathToken.type !== "StringLiteral") {
      this.pushError("Parser: import path must be a string", this.tokenizer.curToken());
      return null;
    }

    this.tokenizer.nextToken(); // consume string literal token

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
    this.rejectIfReserved(name, "struct", identToken);

    if (!this.expectPeek("LBrace")) {
      return null;
    }

    const members: Record<string, StructMember> = {};
    let size = 0;
    let maxAlign = 1;

    // Empty struct (`struct X {}`): advance past `{` so cur lands on `}`.
    if (this.tokenizer.curTokenIs("LBrace") && this.tokenizer.peekTokenIs("RBrace")) {
      this.tokenizer.nextToken();
    }

    while (!this.tokenizer.peekTokenIs("RBrace") && !this.tokenizer.curTokenIs("RBrace")) {
      if (!this.expectPeek("Identifier")) {
        return null;
      }
      const firstIdent = this.tokenizer.curToken();
      const firstName = firstIdent.literal.toString();
      this.rejectIfReserved(firstName, "struct field", firstIdent);
      if (!this.expectPeek("Colon")) {
        return null;
      }
      this.tokenizer.nextToken();
      const firstType = this.parseTyping();
      if (!firstType || firstType === "void") {
        this.pushError("struct member cannot use void type", firstIdent);
        return null;
      }
      const sz = sizeofType(firstType);
      const align = alignofType(firstType);
      size = alignTo(size, align);
      maxAlign = Math.max(maxAlign, align);
      members[firstName] = {
        name: firstName,
        offset: size,
        size: sz,
        type: firstType,
      };
      size += sz;

      // After parseTyping, cur is either on the last type token (scalar/array)
      // or already past it (fn-type, which is fully consuming). Normalize to
      // "cur on the separator (',' or '}')".
      if (!this.tokenizer.curTokenIs("Comma") && !this.tokenizer.curTokenIs("RBrace")) {
        if (this.tokenizer.peekTokenIs("RBrace")) {
          this.tokenizer.nextToken();
          break;
        }
        if (!this.expectPeek("Comma")) {
          return null;
        }
      } else if (this.tokenizer.curTokenIs("RBrace")) {
        break;
      }
      // cur is now ',': the next iteration's while-header or expectPeek("Identifier")
      // will handle trailing comma vs. another field.
    }

    if (this.tokenizer.curTokenIs("Comma")) {
      this.tokenizer.nextToken(); // consume last comma
    }
    if (!this.tokenizer.curTokenIs("RBrace")) {
      return null;
    }
    this.tokenizer.nextToken(); // consume RBRACE

    // Pad the struct so arrays/frames of it keep every field naturally aligned.
    size = alignTo(size, maxAlign);

    return new StructStatement(statementToken, name, members, size, exported);
  }

  private parseLetStatement(
    exported = false,
    mutable = true,
    topLevel = false,
  ): ASTStatement | null {
    const statementToken = this.tokenizer.curToken();
    if (this.tokenizer.peekTokenIs("LParen")) {
      if (topLevel) {
        this.pushError("top-level destructuring let is not supported", statementToken);
        while (!this.tokenizer.curTokenIs("Semicolon") && !this.tokenizer.curTokenIs("EOF")) {
          this.tokenizer.nextToken();
        }
        if (this.tokenizer.curTokenIs("Semicolon")) {
          this.tokenizer.nextToken();
        }
        return null;
      }
      if (!mutable) {
        this.pushError("const destructure is not supported", statementToken);
        while (!this.tokenizer.curTokenIs("Semicolon") && !this.tokenizer.curTokenIs("EOF")) {
          this.tokenizer.nextToken();
        }
        if (this.tokenizer.curTokenIs("Semicolon")) {
          this.tokenizer.nextToken();
        }
        return null;
      }
      return this.parseDestructureLetStatement(statementToken, exported);
    }

    if (!this.expectPeek("Identifier")) {
      return null;
    }
    const identToken = this.tokenizer.curToken();
    this.rejectIfReserved(identToken.literal.toString(), "binding", identToken);

    let typeAnn = "";

    if (this.tokenizer.peekTokenIs("Colon")) {
      this.tokenizer.nextToken(); // advance to ':'
      this.tokenizer.nextToken(); // advance to type token
      const t = this.parseTyping();
      if (!t) return null;
      if (t === "void") return null;
      typeAnn = t; // full type: "i32", "f32", "Point", "i32[]", etc.
    }

    if (!this.tokenizer.curTokenIs("Assign")) {
      if (!this.expectPeek("Assign")) {
        return null;
      }
    }

    this.tokenizer.nextToken();

    const isArray = this.tokenizer.curTokenIs("LBracket");
    const isStruct = this.tokenizer.curTokenIs("LBrace");
    let value: ASTExpression | null = null;
    if (isArray) {
      // Pass the element type ("i32"), not the array type ("i32[]"), so that
      // ArrayLiteralExpression.memberType is always the element type.
      const elementType = typeAnn.endsWith("[]") ? typeAnn.slice(0, -2) : typeAnn;
      value = this.parseArrayLiteral(elementType);
    } else if (isStruct) {
      value = this.parseStructLiteral(typeAnn);
    } else {
      value = this.parseExpression(LOWEST);
    }

    // Infer type if no annotation was provided
    if (typeAnn === "" && value !== null) {
      typeAnn = this.inferTypeFromExpr(value);
      if (typeAnn === "") {
        if (value instanceof CallExpression) {
          const callReturnTypes = this.functionReturnTypes.get(value.func) ?? [];
          if (callReturnTypes.length >= 2) {
            this.pushError(
              "Cannot infer type - for multi-return calls use destructuring `let (a, b) = ...`",
              statementToken,
            );
            return null;
          }
        }
        this.pushError("Cannot infer type; add an explicit type annotation", statementToken);
        return null;
      }
    }

    if (topLevel && typeAnn !== "" && isFnType(typeAnn)) {
      this.pushError("fn-typed bindings are not allowed at module scope yet", statementToken);
      return null;
    }

    if (value !== null) {
      if ((typeAnn === "i64" || typeAnn === "u64") && value instanceof IntegerLiteralExpression) {
        value.numericType = "i64";
      }
      if (typeAnn === "f64" && value instanceof FloatLiteralExpression) {
        value.numericType = "f64";
      }
    }

    // typeAnn is now fully resolved (explicit or inferred); register it
    const identifier = new Identifier(identToken, typeAnn);
    this.identifierTypes.set(identToken.literal.toString(), typeAnn);

    if (!this.expectPeek("Semicolon")) {
      return null;
    }
    this.tokenizer.nextToken(); // consume semicolon

    const letStmt = new LetStatement(statementToken, identifier, typeAnn, value, exported, mutable);
    letStmt.typeAnnotation = typeAnn;

    return letStmt;
  }

  private parseDestructureLetStatement(letToken: Token, exported: boolean): ASTStatement | null {
    if (!this.expectPeek("LParen")) {
      return null;
    }

    this.tokenizer.nextToken(); // first item after '(' or ')'
    const names: TuplePatternName[] = [];
    const seenNames = new Set<string>();

    while (!this.tokenizer.curTokenIs("RParen")) {
      if (!this.tokenizer.curTokenIs("Identifier")) {
        this.pushError("expected identifier or '_' in destructure", this.tokenizer.curToken());
        return null;
      }

      const nameToken = this.tokenizer.curToken();
      const literal = nameToken.literal.toString();
      if (literal === "_") {
        names.push({ kind: "discard", token: nameToken });
      } else {
        if (seenNames.has(literal)) {
          this.pushError("duplicate binding in destructure", nameToken);
          return null;
        }
        seenNames.add(literal);
        this.rejectIfReserved(literal, "binding", nameToken);
        names.push({ kind: "name", value: literal, token: nameToken });
      }

      if (this.tokenizer.peekTokenIs("Colon")) {
        this.pushError(
          "destructuring let does not support per-binding type annotations",
          this.tokenizer.peekToken(),
        );
        return null;
      }

      if (this.tokenizer.peekTokenIs("Comma")) {
        this.tokenizer.nextToken(); // consume comma
        if (this.tokenizer.peekTokenIs("RParen")) {
          this.tokenizer.nextToken(); // consume ')'
          break;
        }
        this.tokenizer.nextToken(); // advance to next name
        continue;
      }

      if (this.tokenizer.peekTokenIs("RParen")) {
        this.tokenizer.nextToken(); // consume ')'
        break;
      }

      this.pushError("expected ',' or ')' in destructure", this.tokenizer.curToken());
      return null;
    }

    if (names.length < 2) {
      this.pushError("destructuring let requires at least 2 names", letToken);
      return null;
    }

    if (this.tokenizer.peekTokenIs("Colon")) {
      this.pushError("destructuring let does not support a tuple type annotation", letToken);
      return null;
    }

    if (!this.expectPeek("Assign")) {
      return null;
    }

    this.tokenizer.nextToken(); // first token of rhs expression
    const rhs = this.parseExpression(LOWEST);
    if (!(rhs instanceof CallExpression)) {
      this.pushError("destructuring let RHS must be a function call", letToken);
      return null;
    }

    if (!this.expectPeek("Semicolon")) {
      return null;
    }
    this.tokenizer.nextToken();

    const rhsReturnTypes = this.functionReturnTypes.get(rhs.func) ?? [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (name?.kind !== "name") continue;
      const inferredType = rhsReturnTypes[i] ?? "";
      this.identifierTypes.set(name.value, inferredType);
      this.locals.push(name.value);
    }

    const pattern = new TuplePattern(letToken, names);
    const letStmt = new LetStatement(letToken, pattern, "", rhs, exported, true);
    letStmt.typeAnnotation = "";
    return letStmt;
  }

  private inferTypeFromExpr(expr: ASTExpression | null): string {
    if (!expr) return "";
    if (expr instanceof IntegerLiteralExpression) {
      return expr.numericType === "i64" ? "i64" : "i32";
    }
    if (expr instanceof FloatLiteralExpression) {
      return expr.numericType === "f64" ? "f64" : "f32";
    }
    if (expr instanceof BooleanLiteralExpression) return "bool";
    if (expr instanceof StringLiteralExpression) return "string";
    if (expr instanceof CastExpression) return expr.targetType;
    if (expr instanceof Identifier) {
      const name = expr.tokenLiteral();
      const intrinsic = getIntrinsic(name);
      if (intrinsic) {
        return canonicalFnType([...intrinsic.params], [intrinsic.result]);
      }
      const fnReturns = this.functionReturnTypes.get(name);
      if (fnReturns !== undefined) {
        const paramTypes = this.functionParamTypes.get(name) ?? [];
        const results = fnReturns.length === 0 ? ["void"] : fnReturns;
        return canonicalFnType(paramTypes, results);
      }
      return this.identifierTypes.get(name) ?? "";
    }
    if (expr instanceof FunctionLiteralExpression) {
      const paramTypes = expr.params.map((p) => p.type);
      const results = expr.returnTypes.length === 0 ? ["void"] : expr.returnTypes;
      return canonicalFnType(paramTypes, results);
    }
    if (expr instanceof StructLiteralExpression) return expr.name;
    if (expr instanceof ArrayLiteralExpression) {
      return expr.memberType ? `${expr.memberType}[]` : "";
    }
    if (expr instanceof MemberExpression) {
      const parentType = this.inferTypeFromExpr(expr.parent);
      if (!parentType) return "";
      const structFields = this.structDefs.get(parentType);
      return structFields?.[expr.member] ?? "";
    }
    if (expr instanceof InfixExpression) {
      const CMP_OPS = new Set(["==", "!=", "<", "<=", ">", ">="]);
      if (CMP_OPS.has(expr.operator)) return "bool";
      const lt = this.inferTypeFromExpr(expr.left);
      const rt = this.inferTypeFromExpr(expr.right);
      if (!lt || !rt) return "";
      const wl = valueTypeToWasm(lt);
      const wr = valueTypeToWasm(rt);
      if (wl === "f32" || wl === "f64" || wr === "f32" || wr === "f64") {
        if (wl === "f64" || wr === "f64") return "f64";
        return "f32";
      }
      if (wl === "i64" || wr === "i64") {
        if (isUnsignedMapleInteger(lt) && isUnsignedMapleInteger(rt)) return "u64";
        return "i64";
      }
      if (isUnsignedMapleInteger(lt) && isUnsignedMapleInteger(rt)) return "u32";
      return "i32";
    }
    if (expr instanceof PrefixExpression) {
      if (expr.operator === "!") return "bool";
      return this.inferTypeFromExpr(expr.right ?? null);
    }
    if (expr instanceof PostfixExpression) {
      return this.inferTypeFromExpr(expr.left ?? null);
    }
    if (expr instanceof CallExpression) {
      const intrinsic = getIntrinsic(expr.func);
      if (intrinsic) return intrinsic.result === "void" ? "" : intrinsic.result;
      const rt = this.functionReturnTypes.get(expr.func) ?? [];
      if (rt.length === 1) return rt[0] ?? "";
      return "";
    }
    return "";
  }

  private parseReturnStatement(): ASTStatement | null {
    const statementToken = this.tokenizer.curToken();
    this.tokenizer.nextToken(); // advance past 'return'

    // bare return: return;
    if (this.tokenizer.curTokenIs("Semicolon")) {
      this.tokenizer.nextToken(); // consume ';'
      return new ReturnStatement(statementToken, []);
    }

    const returnValues: ASTExpression[] = [];
    while (true) {
      // ASSIGN so `return a = b;` is rejected, but every other operator is in.
      const returnExpr = this.parseExpression(ASSIGN);
      if (!returnExpr) {
        return null;
      }
      returnValues.push(returnExpr);

      if (!this.tokenizer.peekTokenIs("Comma")) {
        break;
      }

      this.tokenizer.nextToken(); // consume ','
      if (this.tokenizer.peekTokenIs("Semicolon")) {
        break;
      }
      this.tokenizer.nextToken(); // advance to next expression token
    }

    if (!this.expectPeek("Semicolon")) {
      return null;
    }
    this.tokenizer.nextToken();

    return new ReturnStatement(statementToken, returnValues);
  }

  private parseBlockStatement(): BlockStatement {
    const block = new BlockStatement(this.tokenizer.curToken());

    this.tokenizer.nextToken();

    while (!this.tokenizer.curTokenIs("RBrace") && !this.tokenizer.curTokenIs("EOF")) {
      const stmt = this.parseStatement();
      if (stmt !== null) {
        block.statements.push(stmt);
      } else {
        this.synchronize();
      }
    }

    return block;
  }

  private parseSwitchStatement(): ASTStatement | null {
    const token = this.tokenizer.curToken();

    if (!this.expectPeek("LParen")) {
      return null;
    }
    this.tokenizer.nextToken(); // consume '('
    const switchExpr = this.parseExpression(LOWEST);
    if (!switchExpr) {
      return null;
    }
    if (!this.expectPeek("RParen")) {
      return null;
    }
    if (!this.expectPeek("LBrace")) {
      return null;
    }
    this.tokenizer.nextToken(); // consume '{'

    const cases: Array<{ test: number; body: BlockStatement }> = [];
    let def: BlockStatement | undefined;

    while (!this.tokenizer.curTokenIs("RBrace") && !this.tokenizer.curTokenIs("EOF")) {
      if (this.tokenizer.curTokenIs("Case")) {
        this.tokenizer.nextToken(); // consume 'case'
        let negate = false;
        if (this.tokenizer.curTokenIs("Minus")) {
          negate = true;
          this.tokenizer.nextToken();
        }
        const testToken = this.tokenizer.curToken();
        if (testToken.type !== "IntegerLiteral") {
          this.pushError("Parser: switch case must be an integer literal", testToken);
          return null;
        }
        const testVal = negate ? -(testToken.literal as number) : (testToken.literal as number);
        if (!this.expectPeek("Colon")) {
          return null;
        }
        if (!this.expectPeek("LBrace")) {
          return null;
        }
        const body = this.parseBlockStatement();
        this.tokenizer.nextToken(); // consume '}'
        cases.push({ test: testVal, body });
      } else if (this.tokenizer.curTokenIs("Default")) {
        if (!this.expectPeek("Colon")) {
          return null;
        }
        if (!this.expectPeek("LBrace")) {
          return null;
        }
        def = this.parseBlockStatement();
        this.tokenizer.nextToken(); // consume '}'
      } else {
        break;
      }
    }

    if (!this.tokenizer.curTokenIs("RBrace")) {
      return null;
    }
    this.tokenizer.nextToken(); // consume outer '}'

    return new SwitchStatement(token, switchExpr, cases, def);
  }

  private parseIfStatement(): ASTStatement | null {
    const exprToken = this.tokenizer.curToken();

    if (!this.expectPeek("LParen")) {
      return null;
    }

    this.tokenizer.nextToken();
    const condition = this.parseExpression(LOWEST);

    if (!condition) {
      return null;
    }

    if (!this.expectPeek("RParen")) {
      return null;
    }

    if (!this.expectPeek("LBrace")) {
      return null;
    }

    const consequence = this.parseBlockStatement();
    const expression = new IfStatement(exprToken, condition, consequence);
    if (this.tokenizer.peekTokenIs("Else")) {
      this.tokenizer.nextToken(); // consume 'else'

      if (this.tokenizer.peekTokenIs("If")) {
        this.tokenizer.nextToken(); // consume 'if'
        const elseIfStmt = this.parseIfStatement();
        if (!elseIfStmt) {
          return null;
        }
        const elseBlock = new BlockStatement(this.tokenizer.curToken());
        elseBlock.statements.push(elseIfStmt);
        expression.elseBlock = elseBlock;
        return expression;
      }

      if (!this.expectPeek("LBrace")) {
        return null;
      }

      expression.elseBlock = this.parseBlockStatement();
    }

    if (!this.tokenizer.curTokenIs("RBrace")) {
      return null;
    }
    this.tokenizer.nextToken();

    return expression;
  }

  private parseForStatement(): ASTStatement | null {
    const stmtToken = this.tokenizer.curToken(); // save 'for' token
    if (!this.expectPeek("LParen")) {
      return null;
    }
    this.tokenizer.nextToken();

    // init block
    const initBlock = this.parseLetStatement();
    if (!(initBlock instanceof LetStatement)) {
      return null;
    }

    // conditionExpr
    const conditionExpr = this.parseExpression(LOWEST);
    if (!conditionExpr) {
      return null;
    }
    const conditionStatement = new ExpressionStatement(this.tokenizer.curToken(), conditionExpr);
    this.tokenizer.nextToken(); // consumes last token from the parseExpression call
    if (!this.tokenizer.curTokenIs("Semicolon")) {
      this.pushError("Parser: semicolon expected after for condition expression", stmtToken);
      return null;
    }
    this.tokenizer.nextToken();

    // updateExpr
    const updateToken = this.tokenizer.curToken();
    const updateExpr = this.parseExpression(LOWEST);
    if (!updateExpr) {
      return null;
    }
    const updateExprStatement = new ExpressionStatement(updateToken, updateExpr);

    if (!this.expectPeek("RParen")) {
      return null;
    }
    if (!this.expectPeek("LBrace")) {
      return null;
    }

    const loopBody = this.parseBlockStatement();
    this.tokenizer.nextToken(); // consume closing '}'

    return new ForStatement(
      stmtToken,
      initBlock,
      conditionStatement,
      updateExprStatement,
      loopBody,
    );
  }

  private parseWhileStatement(): ASTStatement | null {
    const stmtToken = this.tokenizer.curToken(); // save 'while' token
    if (!this.expectPeek("LParen")) {
      return null;
    }
    this.tokenizer.nextToken();

    // condition
    const conditionExpr = this.parseExpression(LOWEST);
    if (!conditionExpr) {
      return null;
    }

    if (!this.expectPeek("RParen")) {
      return null;
    }
    if (!this.expectPeek("LBrace")) {
      return null;
    }

    const loopBody = this.parseBlockStatement();
    this.tokenizer.nextToken(); // consume closing '}'

    return new WhileStatement(stmtToken, conditionExpr, loopBody);
  }

  private parseExpressionStatement(): ASTStatement | null {
    const statementToken = this.tokenizer.curToken();

    const expression = this.parseExpression(LOWEST);

    // Always advance past the last token the expression left as curToken.
    // Without this, a missing semicolon keeps curToken unchanged and the
    // outer parse loop spins on the same token forever.
    this.tokenizer.nextToken();
    if (this.tokenizer.curTokenIs("Semicolon")) {
      this.tokenizer.nextToken(); // consume semicolon
    } else {
      this.pushError(
        `Parser: Expected ';' after expression, got ${this.tokenizer.curToken().type}`,
        this.tokenizer.curToken(),
      );
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

    // Infix and postfix tokens both extend `leftExpr` left-to-right while
    // the next token outranks the caller's precedence. Keeping them in one
    // loop ensures `p.x++` parses as `(p.x)++` rather than `p.(x++)`.
    while (
      !(this.tokenizer.peekTokenIs("Semicolon") || this.tokenizer.peekTokenIs("Comma")) &&
      precendence < this.peekPrecedence()
    ) {
      const peekType = this.tokenizer.peekToken().type;
      const infix = this.infixParseFns.get(peekType);
      if (infix) {
        this.tokenizer.nextToken();
        if (leftExpr) {
          leftExpr = infix(leftExpr);
        }
        continue;
      }
      const postfix = this.postfixParseFns.get(peekType);
      if (postfix && leftExpr) {
        this.tokenizer.nextToken();
        leftExpr = postfix(leftExpr);
        continue;
      }
      break;
    }

    return leftExpr;
  }

  private parsePrefixExpression(): ASTExpression {
    const exprToken = this.tokenizer.curToken();
    const literal: string | number = exprToken.literal.toString();
    this.tokenizer.nextToken();
    const right = this.parseExpression(PREFIX);
    if (literal === "-" && right instanceof IntegerLiteralExpression) {
      right.negate();
      return right;
    }
    if (literal === "-" && right instanceof FloatLiteralExpression) {
      right.value = -right.value;
      return right;
    }
    return new PrefixExpression(exprToken, literal.toString(), right);
  }

  private parseUnaryPlus(): ASTExpression | null {
    this.tokenizer.nextToken();
    return this.parseExpression(PREFIX);
  }

  private parseAnonymousStructLiteral(): ASTExpression | null {
    return this.parseStructLiteral("");
  }

  private parseAnonymousArrayLiteral(): ASTExpression | null {
    return this.parseArrayLiteral("");
  }

  private parseInfixExpression(left: ASTExpression): ASTExpression {
    const exprToken = this.tokenizer.curToken();
    const opToken = this.tokenizer.curToken();
    const op = opToken.literal.toString();
    const precedence = this.curPrecedence();
    this.tokenizer.nextToken();
    const right = this.parseExpression(precedence);
    if (!right) {
      const message = `Parser: Fatal: unable to parse right hand side of infix operator ${op}`;
      this.pushError(message, exprToken);
      throw new Error(this.errors.map((e) => e.format()).join("\n"));
    }
    if (op === ".") {
      if (right instanceof Identifier) {
        const member = right.tokenLiteral();
        return new MemberExpression(exprToken, left, member);
      }
    }
    return new InfixExpression(exprToken, left, op, right);
  }

  private parsePostfixExpression(left: ASTExpression): ASTExpression {
    const exprToken = this.tokenizer.curToken();
    const op = this.tokenizer.curToken().literal.toString();
    return new PostfixExpression(exprToken, left, op);
  }

  private parseGroupedExpression(): ASTExpression | null {
    this.tokenizer.nextToken();
    const expr = this.parseExpression(LOWEST);
    if (!this.expectPeek("RParen")) {
      return null;
    }
    return expr;
  }

  private parseIdentifier(): ASTExpression {
    const tok = this.tokenizer.curToken();
    const literal = tok.literal;
    const type = this.getType(literal.toString());
    const ident = new Identifier(tok, type);
    return ident;
  }

  private parseAssignmentExpression(left: ASTExpression): ASTExpression | null {
    const exprToken = this.tokenizer.curToken();
    const op = exprToken.literal.toString();
    this.tokenizer.nextToken();
    const valueExpr = this.parseExpression(LOWEST);
    if (!valueExpr) {
      return null;
    }
    return new AssignmentExpression(exprToken, left, valueExpr, op);
  }

  private parseIndexExpression(left: ASTExpression): ASTExpression | null {
    const token = this.tokenizer.curToken();
    this.tokenizer.nextToken();
    const index = this.parseExpression(LOWEST);
    if (!index) {
      return null;
    }
    if (!this.expectPeek("RBracket")) {
      return null;
    }
    return new IndexExpression(token, left, index);
  }

  private parseCastExpression(left: ASTExpression): ASTExpression | null {
    const token = this.tokenizer.curToken(); // the 'as' token
    this.tokenizer.nextToken(); // advance to the target type
    const targetType = this.parseTyping();
    if (!targetType) {
      return null;
    }
    if (isFnType(targetType)) {
      this.pushError("fn-type casts are not supported", token);
      return null;
    }
    const sourceType = this.inferTypeFromExpr(left);
    if (sourceType !== "" && isFnType(sourceType)) {
      this.pushError("fn-type casts are not supported", token);
      return null;
    }
    return new CastExpression(token, left, targetType);
  }

  private parseCallExpression(func: ASTExpression): ASTExpression {
    const callToken = this.tokenizer.curToken();
    if (func instanceof MemberExpression && func.parent instanceof Identifier) {
      const parentType = this.identifierTypes.get(func.parent.tokenLiteral()) ?? "";
      if (this.structDefs.has(parentType)) {
        const args = this.parseCallArguments();
        return new CallExpression(callToken, `${parentType}_${func.member}`, [
          func.parent,
          ...args,
        ]);
      }
    }
    return new CallExpression(callToken, func.tokenLiteral(), this.parseCallArguments());
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
    if (Number.isNaN(value)) {
      const message = `Parser: Could not parse ${this.tokenizer.curToken().literal} as a number`;
      this.pushError(message, this.tokenizer.curToken());
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
    if (Number.isNaN(value)) {
      const message = `Parser: Could not parse ${this.tokenizer.curToken().literal} as a number`;
      this.pushError(message, this.tokenizer.curToken());
      return null;
    }
    return new IntegerLiteralExpression(literalToken, value, literalToken.rawText);
  }

  private parseBooleanLiteral(): ASTExpression {
    return new BooleanLiteralExpression(
      this.tokenizer.curToken(),
      this.tokenizer.curTokenIs("True"),
    );
  }

  private parseStringLiteral(): ASTExpression {
    const token = this.tokenizer.curToken();
    const value = new TextDecoder().decode(token.literal as Uint8Array);
    return new StringLiteralExpression(token, value);
  }

  private parseArrayLiteral(type: string): ASTExpression | null {
    const literalToken = this.tokenizer.curToken();
    let memberType = type;

    if (!this.tokenizer.curTokenIs("LBracket")) {
      return null;
    }
    this.tokenizer.nextToken(); // consume LBracket
    const value: ASTExpression[] = [];

    // initial values
    if (!this.tokenizer.curTokenIs("RBracket")) {
      const { expr, exprType } = this.parseArrayLiteralMemberTyped();
      if (expr !== null) {
        value.push(expr);
        if (!memberType) memberType = exprType;
      }
    }

    // more values
    while (this.tokenizer.curTokenIs("Comma")) {
      this.tokenizer.nextToken(); // consume Comma
      const { expr } = this.parseArrayLiteralMemberTyped();
      if (expr !== null) {
        value.push(expr);
      }
    }

    if (!this.tokenizer.curTokenIs("RBracket")) {
      return null;
    }

    if (!memberType) {
      this.pushError("Cannot infer array element type; add a type annotation", literalToken);
      return null;
    }

    return new ArrayLiteralExpression(literalToken, memberType, value);
  }

  private parseArrayLiteralMemberTyped(): { expr: ASTExpression | null; exprType: string } {
    const p = this.parseExpression(LOWEST);
    if (!p) {
      this.pushError("Parser: missing expression in array literal", this.tokenizer.curToken());
      return { expr: null, exprType: "" };
    }
    this.tokenizer.nextToken();
    // Literal elements drive the inferred element type; non-literal
    // expressions are accepted syntactically but cannot infer a type.
    if (p instanceof FloatLiteralExpression) return { expr: p, exprType: "f32" };
    if (p instanceof IntegerLiteralExpression) return { expr: p, exprType: "i32" };
    if (p instanceof BooleanLiteralExpression) return { expr: p, exprType: "i32" };
    if (p instanceof StringLiteralExpression) return { expr: p, exprType: "string" };
    return { expr: p, exprType: "" };
  }

  private parseStructLiteral(structName: string): ASTExpression | null {
    const literalToken = this.tokenizer.curToken(); // the LBrace token
    let name = structName;
    const members: Record<string, ASTExpression> = {};
    // Empty struct literal (`{}`): advance past `{` so cur lands on `}`.
    if (this.tokenizer.curTokenIs("LBrace") && this.tokenizer.peekTokenIs("RBrace")) {
      this.tokenizer.nextToken();
    }
    while (!this.tokenizer.peekTokenIs("RBrace") && !this.tokenizer.curTokenIs("RBrace")) {
      if (!this.expectPeek("Identifier")) {
        return null;
      }
      const ident = this.tokenizer.curToken();
      const fieldName = ident.literal.toString();
      if (!this.expectPeek("Assign")) {
        return null;
      }
      this.tokenizer.nextToken();

      const expr = this.parseExpression(LOWEST);
      if (expr) {
        members[fieldName] = expr;
      }

      // account for last item skipping its comma
      if (this.tokenizer.peekTokenIs("RBrace")) {
        this.tokenizer.nextToken();
        break;
      }
      if (!this.expectPeek("Comma")) {
        return null;
      }
    }

    if (this.tokenizer.curTokenIs("Comma")) {
      this.tokenizer.nextToken(); // consume last comma
    }
    if (!this.tokenizer.curTokenIs("RBrace")) {
      return null;
    }

    if (!name) {
      const memberNames = Object.keys(members);
      const matches = [...this.structDefs.entries()].filter(([, fields]) => {
        const fieldNames = Object.keys(fields);
        return fieldNames.length === memberNames.length && memberNames.every((f) => f in fields);
      });
      if (matches.length === 0) {
        this.pushError(
          "Cannot infer struct type from literal; add a type annotation",
          literalToken,
        );
        return null;
      }
      if (matches.length > 1) {
        const names = matches.map(([n]) => n).join(", ");
        this.pushError(
          `Ambiguous struct literal: matches ${names}; add a type annotation`,
          literalToken,
        );
        return null;
      }
      const match = matches[0];
      if (!match) {
        this.pushError(
          "Cannot infer struct type from literal; add a type annotation",
          literalToken,
        );
        return null;
      }
      name = match[0];
    }

    return new StructLiteralExpression(literalToken, name, members);
  }

  private parseFunctionLiteral(): ASTExpression | null {
    const literalToken = this.tokenizer.curToken();

    if (!this.expectPeek("LParen")) {
      return null;
    }

    const parameters = this.parseFunctionParameters();

    if (!this.tokenizer.curTokenIs("Colon")) {
      if (!this.expectPeek("Colon")) {
        return null;
      }
    }
    this.tokenizer.nextToken(); // consume the colon

    let returnTypes: string[];
    if (this.tokenizer.curTokenIs("LParen")) {
      const tupleReturnTypes = this.parseTupleReturnType();
      if (!tupleReturnTypes) {
        return null;
      }
      returnTypes = tupleReturnTypes;
    } else {
      const t = this.parseTyping();
      if (!t) return null;
      returnTypes = t === "void" ? [] : [t];
    }

    if (!this.tokenizer.curTokenIs("LBrace")) {
      if (!this.expectPeek("LBrace")) {
        return null;
      }
    }

    const body = this.parseBlockStatement();

    this.deleteLocals(); // deletes all function locals
    return new FunctionLiteralExpression(literalToken, parameters, body, returnTypes);
  }

  private parseTupleReturnType(consuming = false): string[] | null {
    const startToken = this.tokenizer.curToken();
    const parsedTypes: string[] = [];

    if (this.tokenizer.peekTokenIs("RParen")) {
      this.tokenizer.nextToken();
      this.pushError("multi-return requires at least 2 types", startToken);
      return null;
    }

    this.tokenizer.nextToken(); // first type
    while (true) {
      const parsedType = consuming ? this.parseTypingConsuming() : this.parseTyping();
      if (!parsedType) {
        return null;
      }
      if (parsedType === "void") {
        this.pushError("return type may not contain void", this.tokenizer.curToken());
        return null;
      }
      parsedTypes.push(parsedType);

      if (consuming) {
        if (this.tokenizer.curTokenIs("Comma")) {
          this.tokenizer.nextToken();
          if (this.tokenizer.curTokenIs("RParen")) {
            this.tokenizer.nextToken();
            break;
          }
          continue;
        }
        if (this.tokenizer.curTokenIs("RParen")) {
          this.tokenizer.nextToken();
          break;
        }
      } else {
        // Non-consuming path: cur may be on the last type token (scalar/array)
        // or already past it (fn-type). Handle both by normalizing to
        // "cur on the separator".
        if (this.tokenizer.curTokenIs("Comma")) {
          this.tokenizer.nextToken();
          if (this.tokenizer.curTokenIs("RParen")) {
            this.tokenizer.nextToken();
            break;
          }
          continue;
        }
        if (this.tokenizer.curTokenIs("RParen")) {
          this.tokenizer.nextToken();
          break;
        }

        if (this.tokenizer.peekTokenIs("Comma")) {
          this.tokenizer.nextToken(); // consume comma
          if (this.tokenizer.peekTokenIs("RParen")) {
            this.tokenizer.nextToken(); // consume closing paren
            break;
          }
          this.tokenizer.nextToken(); // next type
          continue;
        }

        if (this.tokenizer.peekTokenIs("RParen")) {
          this.tokenizer.nextToken(); // consume closing paren
          break;
        }
      }

      this.pushError("Parser: expected ',' or ')' in tuple return type", this.tokenizer.curToken());
      return null;
    }

    if (parsedTypes.length < 2) {
      this.pushError("multi-return requires at least 2 types", startToken);
      return null;
    }

    return parsedTypes;
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

    while (true) {
      // After parseTypedParameter, cur is either on the last type token
      // (scalar/array — legacy `parseTyping` doesn't consume) or already past
      // it (fn-type, which is fully consuming). Normalize to "cur on the
      // separator (',' or ')')".
      if (!this.tokenizer.curTokenIs("Comma") && !this.tokenizer.curTokenIs("RParen")) {
        if (this.tokenizer.peekTokenIs("Comma") || this.tokenizer.peekTokenIs("RParen")) {
          this.tokenizer.nextToken();
        } else {
          this.peekError("RParen");
          return [];
        }
      }

      if (this.tokenizer.curTokenIs("RParen")) {
        this.tokenizer.nextToken();
        return params;
      }

      this.tokenizer.nextToken(); // consume ','
      const p = this.parseTypedParameter();
      if (p) params.push(p);
    }
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
    if (!type || type === "void") {
      return null;
    }
    const ident = new Identifier(identToken, type);
    const varName = identToken.literal.toString();
    this.rejectIfReserved(varName, "parameter", identToken);
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

  private parseFnTypeAnnotation(): string | null {
    const fnTok = this.tokenizer.curToken();
    if (!this.tokenizer.curTokenIs("Func")) {
      this.pushError("expected fn in type position", fnTok);
      return null;
    }
    this.tokenizer.nextToken(); // consume Func — current token is '('
    if (!this.tokenizer.curTokenIs("LParen")) {
      this.pushError("expected '(' after fn in type", fnTok);
      return null;
    }
    this.tokenizer.nextToken(); // consume '('

    const params: string[] = [];
    if (!this.tokenizer.curTokenIs("RParen")) {
      while (true) {
        const t = this.parseTypingConsuming();
        if (t === null) return null;
        if (t === "void") {
          this.pushError("void cannot appear as a parameter type", this.tokenizer.curToken());
          return null;
        }
        params.push(t);
        if (this.tokenizer.curTokenIs("Comma")) {
          this.tokenizer.nextToken();
          if (this.tokenizer.curTokenIs("RParen")) {
            this.tokenizer.nextToken();
            break;
          }
          continue;
        }
        if (this.tokenizer.curTokenIs("RParen")) {
          this.tokenizer.nextToken();
          break;
        }
        this.pushError("expected ',' or ')' in fn type parameter list", this.tokenizer.curToken());
        return null;
      }
    } else {
      this.tokenizer.nextToken(); // consume ')'
    }

    if (!this.tokenizer.curTokenIs("Colon")) {
      this.pushError("expected ':' after fn type params", this.tokenizer.curToken());
      return null;
    }
    this.tokenizer.nextToken(); // consume ':'

    let results: string[];
    if (this.tokenizer.curTokenIs("LParen")) {
      const tuple = this.parseTupleReturnType(true);
      if (!tuple) return null;
      results = tuple;
    } else {
      const r = this.parseTypingConsuming();
      if (!r) return null;
      results = [r];
    }

    if (results.length === 0) {
      this.pushError("multi-return requires at least 2 types", fnTok);
      return null;
    }
    if (results.includes("void") && results.length > 1) {
      this.pushError("void cannot appear in a multi-return tuple", fnTok);
      return null;
    }

    return canonicalFnType(params, results);
  }

  private parseTyping(): string | null {
    const curToken = this.tokenizer.curToken();
    if (this.tokenizer.curTokenIs("Func")) {
      return this.parseFnTypeAnnotation();
    }

    let type = curToken.literal.toString();

    const isIdent = this.tokenizer.curTokenIs("Identifier");
    const isBuiltin = BUILTIN_TYPES.includes(curToken.type);

    if (!isIdent && !isBuiltin) {
      this.pushError("Parser: Expected type, none found", this.tokenizer.curToken());
      return null;
    }

    while (this.tokenizer.peekTokenIs("LBracket")) {
      this.tokenizer.nextToken();
      if (!this.expectPeek("RBracket")) {
        this.pushError(
          "Parser: array types must include the ending bracket",
          this.tokenizer.curToken(),
        );
        return null;
      }
      type += "[]";
    }

    return type;
  }

  /** Like `parseTyping` but consumes the type tokens; used only for `fn(...)` type syntax. */
  private parseTypingConsuming(): string | null {
    const curToken = this.tokenizer.curToken();
    if (this.tokenizer.curTokenIs("Func")) {
      return this.parseFnTypeAnnotation();
    }

    let type = curToken.literal.toString();

    const isIdent = this.tokenizer.curTokenIs("Identifier");
    const isBuiltin = BUILTIN_TYPES.includes(curToken.type);

    if (!isIdent && !isBuiltin) {
      this.pushError("Parser: Expected type, none found", this.tokenizer.curToken());
      return null;
    }

    while (this.tokenizer.peekTokenIs("LBracket")) {
      this.tokenizer.nextToken();
      if (!this.expectPeek("RBracket")) {
        this.pushError(
          "Parser: array types must include the ending bracket",
          this.tokenizer.curToken(),
        );
        return null;
      }
      type += "[]";
    }
    this.tokenizer.nextToken();

    return type;
  }

  private getType(ident: string): string {
    const type = this.identifierTypes.get(ident);
    if (!type) {
      return "";
    }
    return type;
  }

  // Error recovery: advance to the next statement boundary so the parse loop
  // can continue after an error without spinning on the same token.
  private synchronize(): void {
    while (!this.tokenizer.curTokenIs("EOF")) {
      if (this.tokenizer.curTokenIs("Semicolon")) {
        this.tokenizer.nextToken();
        return;
      }
      const t = this.tokenizer.curToken().type;
      if (
        t === "Func" ||
        t === "Let" ||
        t === "Const" ||
        t === "Struct" ||
        t === "Return" ||
        t === "If" ||
        t === "For" ||
        t === "While" ||
        t === "Break" ||
        t === "Continue" ||
        t === "Switch" ||
        t === "RBrace"
      ) {
        return;
      }
      this.tokenizer.nextToken();
    }
  }

  // Errors
  private peekError(type: Token["type"]) {
    const peek = this.tokenizer.peekToken();
    const message = `Parser: Expected next token to be ${type}, got ${peek.type}`;
    this.errors.push(new MapleError(message, peek.line, peek.col, this.file));
  }

  private noPrefixParseFnError(type: Token["type"]) {
    const cur = this.tokenizer.curToken();
    const message = `Parser: No prefix parse function found for ${type}.`;
    this.errors.push(new MapleError(message, cur.line, cur.col, this.file));
  }

  private pushError(message: string, token: Token) {
    this.errors.push(new MapleError(message, token.line, token.col, this.file));
  }

  // Function State
  private deleteLocals() {
    for (const l of this.locals) {
      this.identifierTypes.delete(l);
    }
    this.locals.length = 0;
  }
}
