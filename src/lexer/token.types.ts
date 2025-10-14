/**
 *      @TODO:
 *
 *        Compare:    != <= >=
 */

export type Pos = { start: number; end: number; line: number; col: number };
export type Token = Pos &
  // Identifier + literals
  (| IdentToken
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
    | EOFToken
  );

export type IntegerToken = {
  type: "Integer";
  value: number;
};

export type FloatToken = {
  type: "Float";
  value: number;
};

export type StringToken = {
  type: "String";
  value: Uint8Array;
};

export type CharToken = {
  type: "Char";
  value: number;
};

export type IdentToken = {
  type: "Identifier";
  literal: string;
};

export type FuncToken = {
  type: "Func";
  literal: "fn";
};

export type ReturnToken = {
  type: "Return";
  literal: "return";
};

export type IfToken = {
  type: "If";
  literal: "if";
};

export type ElseToken = {
  type: "Else";
  literal: "else";
};

export type ForToken = {
  type: "For";
  literal: "for";
};

export type WhileToken = {
  type: "While";
  literal: "while";
};

export type BreakToken = {
  type: "Break";
  literal: "break";
};

export type ContinueToken = {
  type: "Continue";
  literal: "continue";
};

export type SwitchToken = {
  type: "Switch";
  literal: "switch";
};

export type CaseToken = {
  type: "Case";
  literal: "case";
};

export type DefaultToken = {
  type: "Default";
  literal: "default";
};

export type LetToken = {
  type: "Let";
  literal: "let";
};

export type ConstToken = {
  type: "Const";
  literal: "const";
};

export type StructToken = {
  type: "Struct";
  literal: "struct";
};

export type AsToken = {
  type: "As";
  literal: "as";
};

export type TrueToken = {
  type: "True";
  literal: "true";
};

export type FalseToken = {
  type: "False";
  literal: "false";
};

export type NullToken = {
  type: "Null";
  literal: "null";
};

export type I8TypeToken = {
  type: "i8";
  literal: "i8";
};

export type I16TypeToken = {
  type: "i16";
  literal: "i16";
};

export type I32TypeToken = {
  type: "i32";
  literal: "i32";
};

export type U8TypeToken = {
  type: "u8";
  literal: "u8";
};

export type U16TypeToken = {
  type: "u16";
  literal: "u16";
};

export type U32TypeToken = {
  type: "u32";
  literal: "u32";
};

export type F32TypeToken = {
  type: "f32";
  literal: "f32";
};

export type I64TypeToken = {
  type: "i64";
  literal: "i64";
};

export type U64TypeToken = {
  type: "u64";
  literal: "u64";
};

export type F64TypeToken = {
  type: "f64";
  literal: "f64";
};

export type BoolTypeToken = {
  type: "Boolean";
  literal: "bool";
};

export type StarToken = {
  type: "Star";
  literal: "*";
};

export type PlusToken = {
  type: "Plus";
  literal: "+";
};

export type MinusToken = {
  type: "Minus";
  literal: "-";
};

export type SlashToken = {
  type: "Slash";
  literal: "/";
};

export type PercentToken = {
  type: "Percent";
  literal: "%";
};

export type LessThanToken = {
  type: "LessThan";
  literal: "<";
};

export type GreaterThanToken = {
  type: "GreaterThan";
  literal: ">";
};

export type AmpersandToken = {
  type: "Ampersand";
  literal: "&";
};

export type CaretToken = {
  type: "Caret";
  literal: "^";
};

export type PipeToken = {
  type: "Pipe";
  literal: "|";
};

export type TildeToken = {
  type: "Tilde";
  literal: "~";
};

export type BangToken = {
  type: "Bang";
  literal: "!";
};

export type LogicalAndToken = {
  type: "LogicalAnd";
  literal: "&&";
};

export type LogicalOrToken = {
  type: "LogicalOr";
  literal: "||";
};

export type NotEqualsToken = {
  type: "NotEquals";
  literal: "!=";
};

export type LessThanEqualsToken = {
  type: "LessThanEquals";
  literal: "<=";
};

export type GreaterThanEqualsToken = {
  type: "GreaterThanEquals";
  literal: ">=";
};

export type AssignToken = {
  type: "Assign";
  literal: "=";
};

export type EqualsToken = {
  type: "Equals";
  literal: "==";
};

export type LeftShiftToken = {
  type: "LeftShift";
  literal: "<<";
};

export type RightShiftToken = {
  type: "RightShift";
  literal: ">>";
};

export type ArrowToken = {
  type: "PointerMember";
  literal: "->";
};

export type PeriodToken = {
  type: "Period";
  literal: ".";
};

export type LParenToken = {
  type: "LParen";
  literal: "(";
};

export type RParenToken = {
  type: "RParen";
  literal: ")";
};

export type LBracketToken = {
  type: "LBracket";
  literal: "[";
};

export type RBracketToken = {
  type: "RBracket";
  literal: "]";
};

export type LBraceToken = {
  type: "LBrace";
  literal: "{";
};

export type RBraceToken = {
  type: "RBrace";
  literal: "}";
};

export type CommaToken = {
  type: "Comma";
  literal: ",";
};

export type SemicolonToken = {
  type: "Semicolon";
  literal: ";";
};

export type QuestionToken = {
  type: "Question";
  literal: "?";
};

export type ColonToken = {
  type: "Colon";
  literal: ":";
};

export type AddAssignToken = {
  type: "AddAssign";
  literal: "+=";
};

export type MinusAssignToken = {
  type: "MinusAssign";
  literal: "-=";
};

export type MulAssignToken = {
  type: "MulAssign";
  literal: "*=";
};

export type DivAssignToken = {
  type: "DivAssign";
  literal: "/=";
};

export type ModuloAssignToken = {
  type: "ModuloAssign";
  literal: "%=";
};

export type LeftShiftAssignToken = {
  type: "LeftShiftAssign";
  literal: "<<=";
};

export type RightShiftAssignToken = {
  type: "RightShiftAssign";
  literal: ">>=";
};

export type BitwiseAndAssignToken = {
  type: "BitwiseAnd";
  literal: "&=";
};

export type BitwiseXorAssignToken = {
  type: "BitwiseXor";
  literal: "^=";
};

export type BitwiseOrAssignToken = {
  type: "BitwiseOr";
  literal: "|=";
};

export type IncrementToken = {
  type: "Increment";
  literal: "++";
};

export type DecrementToken = {
  type: "Decrement";
  literal: "--";
};

export type EOFToken = {
  type: "EOF";
  literal: "\0";
};
