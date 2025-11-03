export type Pos = { start: number; end: number; line: number; col: number };

export type Token =
  // Identifier + literals
  | IdentToken
  | IntegerToken
  | FloatToken
  | StringToken
  | CharToken

  // keywords
  | FuncToken
  | ReturnToken
  | IfToken
  | ElseToken
  | ForToken
  | WhileToken
  | BreakToken
  | ContinueToken
  | SwitchToken
  | CaseToken
  | DefaultToken
  | LetToken
  | ConstToken
  | StructToken
  | AsToken
  | TrueToken
  | FalseToken
  | ImportToken
  | ExportToken
  | I8TypeToken
  | U8TypeToken
  | I16TypeToken
  | U16TypeToken
  | I32TypeToken
  | U32TypeToken
  | F32TypeToken
  | I64TypeToken
  | U64TypeToken
  | F64TypeToken
  | BoolTypeToken
  | VoidToken

  // Operators
  | StarToken
  | PlusToken
  | MinusToken
  | SlashToken
  | PercentToken
  | LessThanToken
  | GreaterThanToken
  | AmpersandToken
  | CaretToken
  | PipeToken
  | TildeToken
  | BangToken

  // Logical
  | LogicalAndToken
  | LogicalOrToken
  | NotEqualsToken
  | LessThanEqualsToken
  | GreaterThanEqualsToken
  | EqualsToken

  // Bitwise
  | LeftShiftToken
  | RightShiftToken

  // Assigment
  | AssignToken
  | AddAssignToken
  | MinusAssignToken
  | MulAssignToken
  | DivAssignToken
  | ModuloAssignToken
  | LeftShiftAssignToken
  | RightShiftAssignToken
  | BitwiseAndAssignToken
  | BitwiseXorAssignToken
  | BitwiseOrAssignToken

  // struct member access
  | ArrowToken
  | PeriodToken

  //
  | LParenToken
  | RParenToken
  | LBracketToken
  | RBracketToken
  | LBraceToken
  | RBraceToken
  | CommaToken
  | ColonToken
  | SemicolonToken
  | QuestionToken

  //
  | IncrementToken
  | DecrementToken

  //
  | NullToken
  | EOFToken;

export type IntegerToken = {
  type: "IntegerLiteral";
  literal: number;
} & Pos;

export type FloatToken = {
  type: "FloatLiteral";
  literal: number;
} & Pos;

export type StringToken = {
  type: "StringLiteral";
  literal: Uint8Array;
} & Pos;

export type CharToken = {
  type: "CharLiteral";
  literal: number;
} & Pos;

export type IdentToken = {
  type: "Identifier";
  literal: string;
} & Pos;

export type FuncToken = {
  type: "Func";
  literal: "fn";
} & Pos;

export type ReturnToken = {
  type: "Return";
  literal: "return";
} & Pos;

export type IfToken = {
  type: "If";
  literal: "if";
} & Pos;

export type ElseToken = {
  type: "Else";
  literal: "else";
} & Pos;

export type ForToken = {
  type: "For";
  literal: "for";
} & Pos;

export type WhileToken = {
  type: "While";
  literal: "while";
} & Pos;

export type BreakToken = {
  type: "Break";
  literal: "break";
} & Pos;

export type ContinueToken = {
  type: "Continue";
  literal: "continue";
} & Pos;

export type SwitchToken = {
  type: "Switch";
  literal: "switch";
} & Pos;

export type CaseToken = {
  type: "Case";
  literal: "case";
} & Pos;

export type DefaultToken = {
  type: "Default";
  literal: "default";
} & Pos;

export type LetToken = {
  type: "Let";
  literal: "let";
} & Pos;

export type ConstToken = {
  type: "Const";
  literal: "const";
} & Pos;

export type StructToken = {
  type: "Struct";
  literal: "struct";
} & Pos;

export type AsToken = {
  type: "As";
  literal: "as";
} & Pos;

export type TrueToken = {
  type: "True";
  literal: "true";
} & Pos;

export type FalseToken = {
  type: "False";
  literal: "false";
} & Pos;

export type ImportToken = {
  type: "Import";
  literal: "import";
} & Pos;

export type ExportToken = {
  type: "Export";
  literal: "export";
} & Pos;

export type NullToken = {
  type: "Null";
  literal: "null";
} & Pos;

export type I8TypeToken = {
  type: "i8";
  literal: "i8";
} & Pos;

export type I16TypeToken = {
  type: "i16";
  literal: "i16";
} & Pos;

export type I32TypeToken = {
  type: "i32";
  literal: "i32";
} & Pos;

export type U8TypeToken = {
  type: "u8";
  literal: "u8";
} & Pos;

export type U16TypeToken = {
  type: "u16";
  literal: "u16";
} & Pos;

export type U32TypeToken = {
  type: "u32";
  literal: "u32";
} & Pos;

export type F32TypeToken = {
  type: "f32";
  literal: "f32";
} & Pos;

export type I64TypeToken = {
  type: "i64";
  literal: "i64";
} & Pos;

export type U64TypeToken = {
  type: "u64";
  literal: "u64";
} & Pos;

export type F64TypeToken = {
  type: "f64";
  literal: "f64";
} & Pos;

export type BoolTypeToken = {
  type: "Boolean";
  literal: "bool";
} & Pos;

export type StarToken = {
  type: "Star";
  literal: "*";
} & Pos;

export type PlusToken = {
  type: "Plus";
  literal: "+";
} & Pos;

export type MinusToken = {
  type: "Minus";
  literal: "-";
} & Pos;

export type SlashToken = {
  type: "Slash";
  literal: "/";
} & Pos;

export type PercentToken = {
  type: "Percent";
  literal: "%";
} & Pos;

export type LessThanToken = {
  type: "LessThan";
  literal: "<";
} & Pos;

export type GreaterThanToken = {
  type: "GreaterThan";
  literal: ">";
} & Pos;

export type AmpersandToken = {
  type: "Ampersand";
  literal: "&";
} & Pos;

export type CaretToken = {
  type: "Caret";
  literal: "^";
} & Pos;

export type PipeToken = {
  type: "Pipe";
  literal: "|";
} & Pos;

export type TildeToken = {
  type: "Tilde";
  literal: "~";
} & Pos;

export type BangToken = {
  type: "Bang";
  literal: "!";
} & Pos;

export type LogicalAndToken = {
  type: "LogicalAnd";
  literal: "&&";
} & Pos;

export type LogicalOrToken = {
  type: "LogicalOr";
  literal: "||";
} & Pos;

export type NotEqualsToken = {
  type: "NotEquals";
  literal: "!=";
} & Pos;

export type LessThanEqualsToken = {
  type: "LessThanEquals";
  literal: "<=";
} & Pos;

export type GreaterThanEqualsToken = {
  type: "GreaterThanEquals";
  literal: ">=";
} & Pos;

export type AssignToken = {
  type: "Assign";
  literal: "=";
} & Pos;

export type EqualsToken = {
  type: "Equals";
  literal: "==";
} & Pos;

export type LeftShiftToken = {
  type: "LeftShift";
  literal: "<<";
} & Pos;

export type RightShiftToken = {
  type: "RightShift";
  literal: ">>";
} & Pos;

export type ArrowToken = {
  type: "Arrow";
  literal: "->";
} & Pos;

export type PeriodToken = {
  type: "Period";
  literal: ".";
} & Pos;

export type LParenToken = {
  type: "LParen";
  literal: "(";
} & Pos;

export type RParenToken = {
  type: "RParen";
  literal: ")";
} & Pos;

export type LBracketToken = {
  type: "LBracket";
  literal: "[";
} & Pos;

export type RBracketToken = {
  type: "RBracket";
  literal: "]";
} & Pos;

export type LBraceToken = {
  type: "LBrace";
  literal: "{";
} & Pos;

export type RBraceToken = {
  type: "RBrace";
  literal: "}";
} & Pos;

export type CommaToken = {
  type: "Comma";
  literal: ",";
} & Pos;

export type SemicolonToken = {
  type: "Semicolon";
  literal: ";";
} & Pos;

export type QuestionToken = {
  type: "Question";
  literal: "?";
} & Pos;

export type ColonToken = {
  type: "Colon";
  literal: ":";
} & Pos;

export type AddAssignToken = {
  type: "AddAssign";
  literal: "+=";
} & Pos;

export type MinusAssignToken = {
  type: "MinusAssign";
  literal: "-=";
} & Pos;

export type MulAssignToken = {
  type: "MulAssign";
  literal: "*=";
} & Pos;

export type DivAssignToken = {
  type: "DivAssign";
  literal: "/=";
} & Pos;

export type ModuloAssignToken = {
  type: "ModuloAssign";
  literal: "%=";
} & Pos;

export type LeftShiftAssignToken = {
  type: "LeftShiftAssign";
  literal: "<<=";
} & Pos;

export type RightShiftAssignToken = {
  type: "RightShiftAssign";
  literal: ">>=";
} & Pos;

export type BitwiseAndAssignToken = {
  type: "BitwiseAndAssign";
  literal: "&=";
} & Pos;

export type BitwiseXorAssignToken = {
  type: "BitwiseXorAssign";
  literal: "^=";
} & Pos;

export type BitwiseOrAssignToken = {
  type: "BitwiseOrAssign";
  literal: "|=";
} & Pos;

export type IncrementToken = {
  type: "Increment";
  literal: "++";
} & Pos;

export type DecrementToken = {
  type: "Decrement";
  literal: "--";
} & Pos;

export type EOFToken = {
  type: "EOF";
  literal: "\0";
} & Pos;

export type VoidToken = {
  type: "Void";
  literal: "void";
} & Pos;
