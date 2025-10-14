import type { Token } from "./token.types.js";

export const KEYWORDS = new Map<string, Token["type"]>([
  ["fn", "Func"],
  ["return", "Return"],
  ["if", "If"],
  ["else", "Else"],
  ["for", "For"],
  ["while", "While"],
  ["break", "Break"],
  ["continue", "Continue"],
  ["switch", "Switch"],
  ["case", "Case"],
  ["default", "Default"],
  ["let", "Let"],
  ["const", "Const"],
  ["struct", "Struct"],
  ["true", "True"],
  ["false", "False"],
  ["null", "Null"],
  ["as", "As"],
]);

export const TYPE_KEYWORDS = new Map<string, Token["type"]>([
  ["i8", "i8"],
  ["u8", "u8"],
  ["i16", "i16"],
  ["u16", "u16"],
  ["i32", "i32"],
  ["u32", "u32"],
  ["i64", "i64"],
  ["u64", "u64"],
  ["f32", "f32"],
  ["f64", "f64"],
  ["bool", "Boolean"],
]);
